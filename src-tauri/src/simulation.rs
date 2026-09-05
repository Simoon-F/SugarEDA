use crate::domain::Analysis;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub available: bool,
    pub executable: String,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationResult {
    pub analysis_type: String,
    pub signals: Vec<Signal>,
    pub x_axis: Axis,
    pub warnings: Vec<String>,
    pub log: String,
    pub execution_time_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
pub struct Signal {
    pub name: String,
    pub unit: String,
    pub samples: Vec<f64>,
    pub phase: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Axis {
    pub name: String,
    pub unit: String,
    pub samples: Vec<f64>,
}

#[derive(Debug, Error)]
pub enum SimulationError {
    #[error("ngspice is unavailable: {0}")]
    Unavailable(String),
    #[error("simulation is already running")]
    Busy,
    #[error("simulation was cancelled")]
    Cancelled,
    #[error("ngspice failed: {0}")]
    Failed(String),
    #[error("cannot prepare simulation: {0}")]
    Io(#[from] std::io::Error),
    #[error("cannot parse ngspice output: {0}")]
    Parse(String),
}

pub trait SimulationBackend {
    fn status(&self, configured_path: Option<&str>) -> BackendStatus;
    fn run(
        &self,
        netlist: &str,
        analysis: &Analysis,
        signals: &[String],
        configured_path: Option<&str>,
    ) -> Result<SimulationResult, SimulationError>;
    fn cancel(&self) -> Result<(), SimulationError>;
}

#[derive(Default)]
struct ProcessSlot(Mutex<Option<Child>>);

impl Drop for ProcessSlot {
    fn drop(&mut self) {
        if let Ok(slot) = self.0.get_mut() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct NgSpiceBackend {
    child: Arc<ProcessSlot>,
    running: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    bundled_executable: Option<PathBuf>,
}

impl NgSpiceBackend {
    pub fn new(bundled_executable: Option<PathBuf>) -> Self {
        Self {
            child: Arc::default(),
            running: Arc::default(),
            cancelled: Arc::default(),
            bundled_executable,
        }
    }

    fn executable(&self, configured_path: Option<&str>) -> PathBuf {
        configured_path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("SUGAREDA_NGSPICE_PATH").map(PathBuf::from))
            .or_else(|| self.bundled_executable.clone())
            .unwrap_or_else(|| PathBuf::from("ngspice"))
    }
}

pub fn bundled_executable(resource_dir: &Path) -> Option<PathBuf> {
    let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "macos-aarch64",
        ("macos", "x86_64") => "macos-x86_64",
        ("windows", "x86_64") => "windows-x86_64",
        ("windows", "aarch64") => "windows-aarch64",
        ("linux", "x86_64") => "linux-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        _ => return None,
    };
    let filename = if cfg!(windows) {
        "ngspice.exe"
    } else {
        "ngspice"
    };
    let candidate = resource_dir.join("ngspice").join(platform).join(filename);
    candidate.is_file().then_some(candidate)
}

impl SimulationBackend for NgSpiceBackend {
    fn status(&self, configured_path: Option<&str>) -> BackendStatus {
        let executable = self.executable(configured_path);
        match Command::new(&executable)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
        {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                let version = text
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_owned());
                BackendStatus {
                    available: true,
                    executable: executable.display().to_string(),
                    version,
                    message: if self.bundled_executable.as_ref() == Some(&executable) {
                        "Bundled ngspice is ready — no separate installation required".into()
                    } else {
                        "ngspice override is ready".into()
                    },
                }
            }
            Ok(output) => BackendStatus {
                available: false,
                executable: executable.display().to_string(),
                version: None,
                message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            },
            Err(error) => BackendStatus {
                available: false,
                executable: executable.display().to_string(),
                version: None,
                message: format!("Install ngspice or set SUGAREDA_NGSPICE_PATH ({error})"),
            },
        }
    }

    fn run(
        &self,
        netlist: &str,
        analysis: &Analysis,
        signals: &[String],
        configured_path: Option<&str>,
    ) -> Result<SimulationResult, SimulationError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(SimulationError::Busy);
        }
        struct RunningGuard<'a>(&'a AtomicBool);
        impl Drop for RunningGuard<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _running = RunningGuard(&self.running);
        self.cancelled.store(false, Ordering::SeqCst);
        let executable = self.executable(configured_path);
        let status = self.status(configured_path);
        if !status.available {
            return Err(SimulationError::Unavailable(status.message));
        }
        let dir = tempfile::tempdir()?;
        let circuit = dir.path().join("circuit.cir");
        let raw = dir.path().join("result.raw");
        let log = dir.path().join("ngspice.log");
        fs::write(&circuit, instrument_netlist(netlist, signals)?)?;
        let child = Command::new(&executable)
            .current_dir(dir.path())
            .arg("-n")
            .arg("-b")
            .arg("-o")
            .arg(&log)
            .arg(&circuit)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        *self.child.0.lock().map_err(|_| SimulationError::Busy)? = Some(child);
        let started = Instant::now();
        let exit_status = loop {
            let mut guard = self.child.0.lock().map_err(|_| SimulationError::Busy)?;
            let Some(child) = guard.as_mut() else {
                return Err(SimulationError::Cancelled);
            };
            if self.cancelled.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(60)
            {
                let _ = child.kill();
                let _ = child.wait();
                guard.take();
                return if self.cancelled.load(Ordering::SeqCst) {
                    Err(SimulationError::Cancelled)
                } else {
                    Err(SimulationError::Failed(
                        "Simulation exceeded the 60 second limit".into(),
                    ))
                };
            }
            if let Some(status) = child.try_wait()? {
                guard.take();
                break status;
            }
            drop(guard);
            thread::sleep(Duration::from_millis(40));
        };
        let log_text = fs::read_to_string(&log).unwrap_or_default();
        if !exit_status.success() {
            return Err(SimulationError::Failed(log_text));
        }
        if fs::metadata(&raw)
            .map(|metadata| metadata.len() > 64 * 1024 * 1024)
            .unwrap_or(false)
        {
            return Err(SimulationError::Failed(
                "Result exceeds 64 MiB; reduce the simulation duration or probes".into(),
            ));
        }
        let raw_text = match fs::read_to_string(&raw) {
            Ok(text) => text,
            Err(error) => {
                if let Some(message) = log_text
                    .lines()
                    .find(|line| line.contains("vector ") && line.contains("not available"))
                {
                    return Err(SimulationError::Failed(format!(
                        "Requested probe is unavailable. {} Check that every v(name) probe has a connected network label and every i(name) probe uses an existing SPICE reference",
                        message.trim()
                    )));
                }
                return Err(SimulationError::Parse(format!(
                    "result.raw is unavailable: {error}\n{}",
                    log_text.trim()
                )));
            }
        };
        let mut result = parse_ascii_raw(&raw_text, analysis)?;
        result.log = log_text;
        result.execution_time_ms = started.elapsed().as_millis();
        Ok(result)
    }

    fn cancel(&self) -> Result<(), SimulationError> {
        self.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
}

fn instrument_netlist(netlist: &str, signals: &[String]) -> Result<String, SimulationError> {
    if let Some(signal) = signals.iter().find(|signal| {
        signal.is_empty()
            || signal.len() > 128
            || !signal.chars().all(|character| {
                character.is_ascii_alphanumeric() || "_().,#+-[]:".contains(character)
            })
    }) {
        return Err(SimulationError::Parse(format!(
            "invalid signal expression '{signal}'"
        )));
    }
    let without_end = netlist
        .lines()
        .filter(|line| !line.trim().eq_ignore_ascii_case(".end"))
        .collect::<Vec<_>>()
        .join("\n");
    let outputs = if signals.is_empty() {
        "all".into()
    } else {
        signals.join(" ")
    };
    Ok(format!(
        "{without_end}\n.control\nset filetype=ascii\nrun\nwrite result.raw {outputs}\nquit\n.endc\n.end\n"
    ))
}

pub fn parse_ascii_raw(
    text: &str,
    analysis: &Analysis,
) -> Result<SimulationResult, SimulationError> {
    let mut variable_names = vec![];
    let mut values: BTreeMap<usize, Vec<(f64, f64)>> = BTreeMap::new();
    let mut in_variables = false;
    let mut in_values = false;
    let mut current_point: Option<usize> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "Variables:" {
            in_variables = true;
            in_values = false;
            continue;
        }
        if trimmed == "Values:" {
            in_variables = false;
            in_values = true;
            continue;
        }
        if in_variables {
            let fields: Vec<_> = trimmed.split_whitespace().collect();
            if fields.len() >= 3 {
                variable_names.push((fields[1].to_owned(), fields[2].to_owned()));
            }
        } else if in_values && !trimmed.is_empty() {
            let fields: Vec<_> = trimmed.split_whitespace().collect();
            if fields.len() >= 2 && fields[0].parse::<usize>().is_ok() {
                let point = fields[0]
                    .parse::<usize>()
                    .map_err(|e| SimulationError::Parse(e.to_string()))?;
                let value = parse_number(fields[1])?;
                values.insert(point, vec![value]);
                current_point = Some(point);
            } else if let (Some(point), Some(value)) = (current_point, fields.first()) {
                values.entry(point).or_default().push(parse_number(value)?);
            }
        }
    }
    if variable_names.is_empty() || values.is_empty() {
        return Err(SimulationError::Parse(
            "raw file contains no variables or samples".into(),
        ));
    }
    if values.values().any(|row| row.len() != variable_names.len()) {
        return Err(SimulationError::Parse("incomplete sample table".into()));
    }
    let complex = matches!(analysis, Analysis::AcSweep { .. });
    let operating_point = matches!(analysis, Analysis::OperatingPoint);
    let columns: Vec<Vec<f64>> = (0..variable_names.len())
        .map(|column| {
            values
                .values()
                .map(|row| {
                    if complex && column > 0 {
                        row[column].0.hypot(row[column].1)
                    } else {
                        row[column].0
                    }
                })
                .collect()
        })
        .collect();
    if columns.first().map(Vec::len).unwrap_or(0) != values.len() {
        return Err(SimulationError::Parse("incomplete sample table".into()));
    }
    let (x_name, x_kind) = &variable_names[0];
    // ngspice always writes its scale vector, even when explicitly requested again.
    let mut seen = std::collections::BTreeSet::new();
    let signals = variable_names
        .iter()
        .enumerate()
        .skip(if operating_point { 0 } else { 1 })
        .filter(|(_, (name, _))| seen.insert(name.to_ascii_lowercase()))
        .map(|(index, (name, kind))| Signal {
            name: name.clone(),
            unit: unit_for(kind),
            samples: columns[index].clone(),
            phase: complex.then(|| {
                values
                    .values()
                    .map(|row| row[index].1.atan2(row[index].0).to_degrees())
                    .collect()
            }),
        })
        .collect();
    Ok(SimulationResult {
        analysis_type: match analysis {
            Analysis::OperatingPoint => "operatingPoint",
            Analysis::Transient { .. } => "transient",
            Analysis::DcSweep { .. } => "dcSweep",
            Analysis::AcSweep { .. } => "acSweep",
        }
        .into(),
        signals,
        x_axis: Axis {
            name: if operating_point {
                "point".into()
            } else {
                x_name.clone()
            },
            unit: if operating_point {
                String::new()
            } else {
                unit_for(x_kind)
            },
            samples: if operating_point {
                (0..values.len()).map(|index| index as f64).collect()
            } else {
                columns[0].clone()
            },
        },
        warnings: vec![],
        log: String::new(),
        execution_time_ms: 0,
    })
}

fn parse_number(value: &str) -> Result<(f64, f64), SimulationError> {
    let mut values = value.split(',');
    let real = values
        .next()
        .unwrap_or(value)
        .parse::<f64>()
        .map_err(|_| SimulationError::Parse(format!("invalid numeric sample '{value}'")))?;
    let imaginary = values
        .next()
        .unwrap_or("0")
        .parse::<f64>()
        .map_err(|_| SimulationError::Parse(format!("invalid numeric sample '{value}'")))?;
    if !real.is_finite() || !imaginary.is_finite() || values.next().is_some() {
        return Err(SimulationError::Parse(format!(
            "invalid numeric sample '{value}'"
        )));
    }
    Ok((real, imaginary))
}
fn unit_for(kind: &str) -> String {
    match kind.to_ascii_lowercase().as_str() {
        "time" => "s",
        "voltage" => "V",
        "current" => "A",
        "frequency" => "Hz",
        _ => "",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn real_backend() -> Option<NgSpiceBackend> {
        let backend = NgSpiceBackend::default();
        let available = backend.status(None).available;
        assert!(
            available || std::env::var_os("SUGAREDA_REQUIRE_NGSPICE").is_none(),
            "real ngspice is required for this test run"
        );
        available.then_some(backend)
    }
    const RAW: &str = "Title: rc\nNo. Variables: 3\nNo. Points: 2\nVariables:\n  0 time time\n  1 v(in) voltage\n  2 v(out) voltage\nValues:\n 0 0.000000e+00\n 5.000000e+00\n 0.000000e+00\n 1 1.000000e-05\n 5.000000e+00\n 4.975000e-02\n";
    #[test]
    fn parses_ascii_fixture() {
        let r = parse_ascii_raw(
            RAW,
            &Analysis::Transient {
                step: "10u".into(),
                stop: "30m".into(),
            },
        )
        .unwrap();
        assert_eq!(r.x_axis.samples.len(), 2);
        assert_eq!(r.signals[1].samples[1], 0.04975);
    }
    #[test]
    fn instrumentation_keeps_end_last() {
        let s = instrument_netlist("R1 1 0 1k\n.end", &["v(1)".into()]).unwrap();
        assert!(s.contains("write result.raw v(1)"));
        assert!(s.ends_with(".end\n"));
    }

    #[test]
    fn discovers_packaged_platform_binary() {
        let root = tempfile::tempdir().unwrap();
        let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "macos-aarch64",
            ("macos", "x86_64") => "macos-x86_64",
            ("windows", "x86_64") => "windows-x86_64",
            ("windows", "aarch64") => "windows-aarch64",
            ("linux", "x86_64") => "linux-x86_64",
            ("linux", "aarch64") => "linux-aarch64",
            _ => return,
        };
        let filename = if cfg!(windows) {
            "ngspice.exe"
        } else {
            "ngspice"
        };
        let binary = root.path().join("ngspice").join(platform).join(filename);
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, b"fixture").unwrap();
        assert_eq!(bundled_executable(root.path()), Some(binary));
    }

    #[test]
    fn runs_rc_with_real_ngspice_when_available() {
        let Some(backend) = real_backend() else {
            return;
        };
        let analysis = Analysis::Transient {
            step: "10u".into(),
            stop: "1m".into(),
        };
        let netlist = "* RC integration\nV1 in 0 PULSE(0 5 0 1u 1u 500u 1m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 1m\n.end";
        let result = backend
            .run(netlist, &analysis, &["v(in)".into(), "v(out)".into()], None)
            .unwrap();
        assert!(result.x_axis.samples.len() > 10);
        assert_eq!(result.signals.len(), 2, "{:?}", result.signals);
    }

    #[test]
    fn real_ac_has_correct_cutoff_magnitude_and_phase() {
        let Some(backend) = real_backend() else {
            return;
        };
        let analysis = Analysis::AcSweep {
            variation: "dec".into(),
            points: 10,
            start: "159.154943".into(),
            stop: "1591.54943".into(),
        };
        let result = backend.run("* AC\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 159.154943 1591.54943\n.end", &analysis, &["v(out)".into()], None).unwrap();
        assert_eq!(result.x_axis.unit, "Hz");
        assert!((result.signals[0].samples[0] - 1.0 / 2f64.sqrt()).abs() < 1e-6);
        assert!((result.signals[0].phase.as_ref().unwrap()[0] + 45.0).abs() < 1e-5);
    }

    #[test]
    fn real_op_keeps_all_voltages_and_dc_sweeps() {
        let Some(backend) = real_backend() else {
            return;
        };
        let circuit = "* divider\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n";
        let result = backend
            .run(
                &format!("{circuit}.op\n.end"),
                &Analysis::OperatingPoint,
                &["v(in)".into(), "v(out)".into()],
                None,
            )
            .unwrap();
        assert_eq!(result.signals.len(), 2, "{:?}", result.signals);
        assert_eq!(result.signals[0].samples, vec![5.0]);
        assert_eq!(result.signals[1].samples, vec![2.5]);
        let analysis = Analysis::DcSweep {
            source: "V1".into(),
            start: "0".into(),
            stop: "5".into(),
            step: "1".into(),
        };
        let result = backend
            .run(
                &format!("{circuit}.dc V1 0 5 1\n.end"),
                &analysis,
                &["v(out)".into()],
                None,
            )
            .unwrap();
        assert_eq!(result.x_axis.samples.len(), 6);
        assert!((result.signals[0].samples[5] - 2.5).abs() < 1e-9);
    }

    #[test]
    fn real_imported_subcircuit_runs() {
        let Some(backend) = real_backend() else {
            return;
        };
        let library = crate::models::import(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../examples/models/learning.lib"
        )))
        .unwrap();
        let mut workspace = crate::application::Workspace::new(crate::domain::test_rc_project());
        workspace.add_spice_library(library.clone()).unwrap();
        // Exercise the webview's camelCase IPC payload and portable project persistence.
        let command = serde_json::from_value(serde_json::json!({"action":"addModelComponent", "libraryId":library.id, "modelName":"SUGAR_FILTER", "position":{"x":600,"y":500}})).unwrap();
        workspace.apply(command).unwrap();
        // Replace the discrete RC with the imported filter and connect by declared pin order.
        use crate::domain::{ComponentKind, Point, Wire};
        let sheet = &mut workspace.project.sheets[0];
        sheet.components.retain(|component| {
            !matches!(
                component.kind,
                ComponentKind::Resistor | ComponentKind::Capacitor
            )
        });
        let filter = sheet.components.last().unwrap().clone();
        let endpoints = [
            Point { x: 180., y: 170. },
            Point { x: 380., y: 170. },
            Point { x: 320., y: 310. },
        ];
        sheet.wires.clear();
        for (pin, endpoint) in filter.pins.iter().zip(endpoints) {
            sheet.wires.push(Wire {
                id: uuid::Uuid::new_v4(),
                points: vec![
                    Point {
                        x: filter.position.x + pin.offset.x,
                        y: filter.position.y + pin.offset.y,
                    },
                    endpoint,
                ],
            });
        }
        // A high impedance load also makes the external output connectivity explicit.
        sheet.components.push(crate::domain::component(
            ComponentKind::Resistor,
            420.,
            170.,
            "RLOAD",
            "1G",
        ));
        sheet.wires.push(Wire {
            id: uuid::Uuid::new_v4(),
            points: vec![Point { x: 460., y: 170. }, Point { x: 320., y: 310. }],
        });
        sheet.wires.push(Wire {
            id: uuid::Uuid::new_v4(),
            points: vec![Point { x: 180., y: 230. }, Point { x: 320., y: 310. }],
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.sugeda");
        crate::project::save(&path, &workspace.project).unwrap();
        let loaded = crate::project::load(&path).unwrap();
        assert_eq!(loaded, workspace.project);
        assert_eq!(
            loaded.sheets[0]
                .components
                .iter()
                .find(|component| component.spice_ref == "X1")
                .unwrap()
                .pins
                .len(),
            3
        );
        let netlist = crate::netlist::generate(&loaded).unwrap();
        assert!(netlist.contains("X1 in out 0 SUGAR_FILTER"));
        let result = backend
            .run(
                &netlist,
                &Analysis::Transient {
                    step: "10u".into(),
                    stop: "5m".into(),
                },
                &["v(out)".into()],
                None,
            )
            .unwrap();
        assert!(result.signals[0].samples.iter().any(|value| *value > 4.9));
    }

    #[test]
    fn rejects_invalid_numeric_samples_and_probe_injection() {
        assert!(parse_number("NaN").is_err());
        assert!(parse_number("1,2,3").is_err());
        assert!(instrument_netlist(".end", &["v(out)\nshell bad".into()]).is_err());
        assert!(
            parse_ascii_raw(&RAW.replace("4.975000e-02", ""), &Analysis::OperatingPoint).is_err()
        );
    }
}
