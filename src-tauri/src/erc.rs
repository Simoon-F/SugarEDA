use crate::domain::{ComponentKind, PinElectricalType, Point, Project};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErcIssue {
    pub code: &'static str,
    pub severity: &'static str,
    pub device_id: Uuid,
    pub pin_id: Option<String>,
    pub message_zh: String,
    pub message_en: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErcReport {
    pub passed: bool,
    pub issues: Vec<ErcIssue>,
    pub checked_devices: usize,
    pub checked_pins: usize,
}

type Key = (i64, i64);
fn key(point: Point) -> Key {
    (
        (point.x * 1000.0).round() as i64,
        (point.y * 1000.0).round() as i64,
    )
}
fn on_segment(p: Key, a: Key, b: Key) -> bool {
    (p.0 - a.0) * (b.1 - a.1) == (p.1 - a.1) * (b.0 - a.0)
        && p.0 >= a.0.min(b.0)
        && p.0 <= a.0.max(b.0)
        && p.1 >= a.1.min(b.1)
        && p.1 <= a.1.max(b.1)
}
fn absolute(component: &crate::domain::Component, offset: Point) -> Key {
    let rotated = match component.rotation.rem_euclid(360) {
        90 => Point {
            x: -offset.y,
            y: offset.x,
        },
        180 => Point {
            x: -offset.x,
            y: -offset.y,
        },
        270 => Point {
            x: offset.y,
            y: -offset.x,
        },
        _ => offset,
    };
    key(Point {
        x: component.position.x + rotated.x,
        y: component.position.y + rotated.y,
    })
}

#[derive(Default)]
struct UnionFind {
    parent: HashMap<Key, Key>,
}
impl UnionFind {
    fn add(&mut self, k: Key) {
        self.parent.entry(k).or_insert(k);
    }
    fn find(&mut self, k: Key) -> Key {
        self.add(k);
        let p = self.parent[&k];
        if p == k {
            k
        } else {
            let r = self.find(p);
            self.parent.insert(k, r);
            r
        }
    }
    fn union(&mut self, a: Key, b: Key) {
        let a = self.find(a);
        let b = self.find(b);
        if a != b {
            self.parent.insert(b, a);
        }
    }
}

struct PinRef<'a> {
    component: &'a crate::domain::Component,
    pin: &'a crate::domain::Pin,
    point: Key,
}

fn issue(
    code: &'static str,
    device_id: Uuid,
    pin_id: Option<String>,
    zh: String,
    en: String,
) -> ErcIssue {
    ErcIssue {
        code,
        severity: "error",
        device_id,
        pin_id,
        message_zh: zh,
        message_en: en,
    }
}

pub fn check(project: &Project) -> ErcReport {
    let sheet = match crate::hierarchy::flatten_for_erc(project) {
        Ok(sheet) => sheet,
        Err(error) => {
            return ErcReport {
                passed: false,
                issues: vec![issue(
                    "erc.invalid_hierarchy",
                    project.metadata.id,
                    None,
                    format!("层次原理图无效：{error}"),
                    format!("Invalid schematic hierarchy: {error}"),
                )],
                checked_devices: 0,
                checked_pins: 0,
            };
        }
    };
    let mut combined = check_sheet(&sheet);
    combined.issues.sort_by(|a, b| {
        (a.device_id, a.pin_id.as_deref(), a.code).cmp(&(b.device_id, b.pin_id.as_deref(), b.code))
    });
    combined.passed = combined.issues.is_empty();
    combined
}

fn check_sheet(sheet: &crate::domain::SchematicSheet) -> ErcReport {
    let components: Vec<_> = sheet
        .components
        .iter()
        .filter(|c| c.kind == ComponentKind::Device)
        .collect();
    let pins: Vec<_> = components
        .iter()
        .flat_map(|component| {
            component.pins.iter().map(move |pin| PinRef {
                component,
                pin,
                point: absolute(component, pin.offset),
            })
        })
        .collect();
    let connectors: Vec<(String, Key)> = sheet
        .components
        .iter()
        .filter(|component| crate::hierarchy::is_label(&component.kind))
        .map(|component| {
            (
                crate::hierarchy::connector_name(component).to_ascii_lowercase(),
                key(component.position),
            )
        })
        .chain(
            sheet
                .net_labels
                .iter()
                .map(|label| (label.name.to_ascii_lowercase(), key(label.position))),
        )
        .collect();
    let mut uf = UnionFind::default();
    for pin in &pins {
        uf.add(pin.point);
    }
    for (_, point) in &connectors {
        uf.add(*point);
    }
    let mut wire_points = BTreeSet::new();
    for wire in &sheet.wires {
        for point in &wire.points {
            uf.add(key(*point));
            wire_points.insert(key(*point));
        }
        for segment in wire.points.windows(2) {
            let a = key(segment[0]);
            let b = key(segment[1]);
            uf.union(a, b);
            for pin in &pins {
                if on_segment(pin.point, a, b) {
                    uf.union(a, pin.point);
                }
            }
            for (_, point) in &connectors {
                if on_segment(*point, a, b) {
                    uf.union(a, *point);
                }
            }
            for other in &sheet.wires {
                for point in &other.points {
                    let p = key(*point);
                    if on_segment(p, a, b) {
                        uf.union(a, p);
                    }
                }
            }
        }
    }
    let mut connector_roots = HashMap::new();
    for (name, point) in &connectors {
        if let Some(previous) = connector_roots.insert(name, *point) {
            uf.union(previous, *point);
        }
    }
    let mut roots_with_wire = BTreeSet::new();
    for point in wire_points {
        roots_with_wire.insert(uf.find(point));
    }
    let mut by_root: BTreeMap<Key, Vec<&PinRef<'_>>> = BTreeMap::new();
    for pin in &pins {
        by_root.entry(uf.find(pin.point)).or_default().push(pin);
    }
    let connected = |uf: &mut UnionFind, pin: &PinRef<'_>| {
        roots_with_wire.contains(&uf.find(pin.point))
            || by_root
                .get(&uf.find(pin.point))
                .is_some_and(|v| v.len() > 1)
    };
    let mut issues = vec![];
    for pin in &pins {
        if pin.pin.no_connect || pin.pin.allow_floating {
            continue;
        }
        if !connected(&mut uf, pin) {
            let name = format!(
                "{} ({})",
                pin.pin.name,
                pin.pin.number.as_deref().unwrap_or(&pin.pin.id)
            );
            if pin.pin.electrical_type == Some(PinElectricalType::PowerInput) {
                issues.push(issue(
                    "erc.power_input_unconnected",
                    pin.component.id,
                    Some(pin.pin.id.clone()),
                    format!("电源输入引脚 {name} 未连接"),
                    format!("Power-input pin {name} is not connected"),
                ));
            } else if pin.pin.required {
                issues.push(issue(
                    "erc.required_pin_unconnected",
                    pin.component.id,
                    Some(pin.pin.id.clone()),
                    format!("必接引脚 {name} 悬空"),
                    format!("Required pin {name} is floating"),
                ));
            }
        }
    }
    for root_pins in by_root.values() {
        let outputs: Vec<_> = root_pins
            .iter()
            .filter(|p| {
                p.pin.electrical_type == Some(PinElectricalType::PowerOutput) && !p.pin.no_connect
            })
            .collect();
        if outputs.len() > 1 {
            for output in outputs {
                issues.push(issue(
                    "erc.power_output_conflict",
                    output.component.id,
                    Some(output.pin.id.clone()),
                    "同一网络连接了多个电源输出".into(),
                    "Multiple power outputs drive the same net".into(),
                ));
            }
        }
        let domains: Vec<_> = root_pins
            .iter()
            .filter_map(|p| {
                Some((
                    *p,
                    p.pin.voltage_domain_id.as_ref()?,
                    p.pin.voltage_min?,
                    p.pin.voltage_max?,
                ))
            })
            .collect();
        'domain: for (index, (pin, domain, min, max)) in domains.iter().enumerate() {
            for (_, other_domain, other_min, other_max) in domains.iter().skip(index + 1) {
                if domain != other_domain && (max < other_min || other_max < min) {
                    issues.push(issue("erc.voltage_domain_conflict", pin.component.id, Some(pin.pin.id.clone()), format!("电压域 {domain} 与 {other_domain} 的允许范围不相交"), format!("Voltage domains {domain} and {other_domain} have non-overlapping ranges")));
                    break 'domain;
                }
            }
        }
        let differential: Vec<_> = root_pins
            .iter()
            .filter(|p| p.pin.differential_polarity.is_some())
            .collect();
        for (index, pin) in differential.iter().enumerate() {
            for other in differential.iter().skip(index + 1) {
                if pin.component.id != other.component.id
                    && pin.pin.differential_polarity != other.pin.differential_polarity
                {
                    issues.push(issue(
                        "erc.differential_polarity_reversed",
                        pin.component.id,
                        Some(pin.pin.id.clone()),
                        "差分对 P/N 连接到相反极性".into(),
                        "Differential P/N is connected to the opposite polarity".into(),
                    ));
                }
            }
        }
    }
    let mut instance_pins: BTreeMap<Uuid, Vec<&PinRef<'_>>> = BTreeMap::new();
    for pin in &pins {
        let identity = pin
            .component
            .device
            .as_ref()
            .and_then(|binding| binding.logical_instance_id)
            .unwrap_or(pin.component.id);
        instance_pins.entry(identity).or_default().push(pin);
    }
    for instance in instance_pins.values() {
        let mut pairs: BTreeMap<&str, Vec<&PinRef<'_>>> = BTreeMap::new();
        for pin in instance {
            if let Some(pair) = pin.pin.differential_pair_id.as_deref() {
                pairs.entry(pair).or_default().push(pin);
            }
        }
        for (pair, pair_pins) in pairs {
            if pair_pins.len() != 2 {
                continue;
            }
            let a = pair_pins[0];
            let b = pair_pins[1];
            let ac = connected(&mut uf, a);
            let bc = connected(&mut uf, b);
            if ac != bc {
                let missing = if ac { b } else { a };
                issues.push(issue(
                    "erc.differential_pair_incomplete",
                    missing.component.id,
                    Some(missing.pin.id.clone()),
                    format!("差分对 {pair} 只连接了一端"),
                    format!("Differential pair {pair} has only one connected side"),
                ));
            }
        }
    }
    issues.sort_by(|a, b| {
        (a.device_id, a.pin_id.as_deref(), a.code).cmp(&(b.device_id, b.pin_id.as_deref(), b.code))
    });
    ErcReport {
        passed: issues.is_empty(),
        issues,
        checked_devices: components.len(),
        checked_pins: pins.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Component, Pin};
    use std::collections::BTreeMap;

    fn test_component(x: f64, pins: Vec<Pin>) -> Component {
        Component {
            id: Uuid::new_v4(),
            kind: ComponentKind::Device,
            position: Point { x, y: 100.0 },
            rotation: 0,
            parameters: BTreeMap::new(),
            pins,
            display_name: "Test device".into(),
            spice_ref: "U1".into(),
            model: None,
            device: None,
            symbol_width: Some(80.0),
            symbol_height: Some(80.0),
        }
    }

    fn pin(id: &str, x: f64, kind: PinElectricalType) -> Pin {
        Pin {
            id: id.into(),
            name: id.into(),
            number: Some(id.into()),
            electrical_type: Some(kind),
            offset: Point { x, y: 0.0 },
            ..Pin::default()
        }
    }

    #[test]
    fn reports_required_power_and_differential_issues() {
        let embedded = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-soc.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("erc");
        project.device_packs.push(embedded.clone());
        let component = crate::device_pack::instantiate(
            &project,
            &embedded.sha256,
            "stsoc144",
            Some("base"),
            Some("usb"),
            Point { x: 500.0, y: 500.0 },
        )
        .unwrap();
        let positive = component
            .pins
            .iter()
            .find(|p| p.differential_polarity.as_deref() == Some("positive"))
            .unwrap();
        let start = Point {
            x: component.position.x + positive.offset.x,
            y: component.position.y + positive.offset.y,
        };
        project.sheets[0].wires.push(crate::domain::Wire {
            id: Uuid::new_v4(),
            points: vec![
                start,
                Point {
                    x: start.x - 40.0,
                    y: start.y,
                },
            ],
        });
        project.sheets[0].components.push(component);
        let report = check(&project);
        assert!(report
            .issues
            .iter()
            .any(|i| i.code == "erc.differential_pair_incomplete"));
    }

    #[test]
    fn reports_required_and_power_inputs_but_honors_explicit_no_connect() {
        let mut required = pin("required", -20.0, PinElectricalType::Input);
        required.required = true;
        let power = pin("power", 0.0, PinElectricalType::PowerInput);
        let mut nc = pin("intentional-nc", 20.0, PinElectricalType::Input);
        nc.required = true;
        nc.no_connect = true;
        let mut project = Project::blank("erc");
        project.sheets[0]
            .components
            .push(test_component(100.0, vec![required, power, nc]));
        let report = check(&project);
        assert_eq!(
            report
                .issues
                .iter()
                .filter(|issue| issue.code == "erc.required_pin_unconnected")
                .count(),
            1
        );
        assert_eq!(
            report
                .issues
                .iter()
                .filter(|issue| issue.code == "erc.power_input_unconnected")
                .count(),
            1
        );
        assert!(!report
            .issues
            .iter()
            .any(|issue| issue.pin_id.as_deref() == Some("intentional-nc")));
    }

    #[test]
    fn aggregates_erc_issues_across_all_sheets() {
        let mut project = Project::blank("multi-sheet erc");
        let mut required_a = pin("required-a", 0.0, PinElectricalType::Input);
        required_a.required = true;
        project.sheets[0]
            .components
            .push(test_component(100.0, vec![required_a]));
        let second = crate::schematic_sheet::add(&mut project, "IO".into()).unwrap();
        let mut required_b = pin("required-b", 0.0, PinElectricalType::Input);
        required_b.required = true;
        crate::schematic_sheet::active_mut(&mut project)
            .unwrap()
            .components
            .push(test_component(200.0, vec![required_b]));
        let report = check(&project);
        assert_eq!(report.checked_devices, 2);
        assert_eq!(
            report
                .issues
                .iter()
                .filter(|issue| issue.code == "erc.required_pin_unconnected")
                .count(),
            2
        );
        assert_eq!(project.ui_view_state.active_sheet_id, second);
    }

    #[test]
    fn global_label_exposes_cross_sheet_power_output_conflicts() {
        let mut project = Project::blank("cross-sheet erc");
        let first = test_component(
            100.0,
            vec![pin("out-a", 20.0, PinElectricalType::PowerOutput)],
        );
        let global_a =
            crate::domain::component(ComponentKind::GlobalLabel, 140.0, 100.0, "", "VCC_SHARED");
        project.sheets[0].components.extend([first, global_a]);
        project.sheets[0].wires.push(crate::domain::Wire {
            id: Uuid::new_v4(),
            points: vec![Point { x: 120.0, y: 100.0 }, Point { x: 140.0, y: 100.0 }],
        });

        crate::schematic_sheet::add(&mut project, "Power".into()).unwrap();
        let second = test_component(
            200.0,
            vec![pin("out-b", -20.0, PinElectricalType::PowerOutput)],
        );
        let global_b =
            crate::domain::component(ComponentKind::GlobalLabel, 160.0, 100.0, "", "VCC_SHARED");
        project.sheets[1].components.extend([second, global_b]);
        project.sheets[1].wires.push(crate::domain::Wire {
            id: Uuid::new_v4(),
            points: vec![Point { x: 180.0, y: 100.0 }, Point { x: 160.0, y: 100.0 }],
        });

        let report = check(&project);
        assert_eq!(
            report
                .issues
                .iter()
                .filter(|issue| issue.code == "erc.power_output_conflict")
                .count(),
            2
        );
    }

    #[test]
    fn reports_power_output_and_incompatible_voltage_domains() {
        let mut a = pin("out-a", 20.0, PinElectricalType::PowerOutput);
        a.voltage_domain_id = Some("core".into());
        a.voltage_min = Some(0.8);
        a.voltage_max = Some(0.9);
        let mut b = pin("out-b", -20.0, PinElectricalType::PowerOutput);
        b.voltage_domain_id = Some("io".into());
        b.voltage_min = Some(3.0);
        b.voltage_max = Some(3.6);
        let first = test_component(100.0, vec![a]);
        let second = test_component(140.0, vec![b]);
        let start = Point { x: 120.0, y: 100.0 };
        let mut project = Project::blank("erc");
        project.sheets[0].components.extend([first, second]);
        project.sheets[0].wires.push(crate::domain::Wire {
            id: Uuid::new_v4(),
            points: vec![start, start],
        });
        let report = check(&project);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "erc.power_output_conflict"));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "erc.voltage_domain_conflict"));
    }

    #[test]
    fn detects_crossed_differential_polarity() {
        let pair_pin = |id: &str, x: f64, polarity: &str| {
            let mut value = pin(id, x, PinElectricalType::Bidirectional);
            value.differential_pair_id = Some("lane0".into());
            value.differential_polarity = Some(polarity.into());
            value
        };
        let first = test_component(
            100.0,
            vec![
                pair_pin("a-p", 20.0, "positive"),
                pair_pin("a-n", 20.0, "negative"),
            ],
        );
        let second = test_component(
            200.0,
            vec![
                pair_pin("b-p", -20.0, "positive"),
                pair_pin("b-n", -20.0, "negative"),
            ],
        );
        let mut project = Project::blank("erc");
        let a_id = first.id;
        project.sheets[0].components.extend([first, second]);
        project.sheets[0].wires.extend([crate::domain::Wire {
            id: Uuid::new_v4(),
            points: vec![Point { x: 120.0, y: 100.0 }, Point { x: 180.0, y: 100.0 }],
        }]);
        let report = check(&project);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "erc.differential_polarity_reversed"
                && issue.device_id == a_id));
    }
}
