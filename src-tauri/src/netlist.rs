use crate::domain::{
    Analysis, Component, ComponentKind, Point, Project, SchematicSheet, SimulationProfile,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Error)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct NetlistError {
    pub code: &'static str,
    pub message: String,
    pub component_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationCheckIssue {
    pub code: &'static str,
    pub category: &'static str,
    pub message: String,
    pub component_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationCheckItem {
    pub category: &'static str,
    pub passed: bool,
    pub issue_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationCheckReport {
    pub ready: bool,
    pub checks: Vec<SimulationCheckItem>,
    pub issues: Vec<SimulationCheckIssue>,
    pub netlist: Option<String>,
}

type Key = (i64, i64);
fn key(point: Point) -> Key {
    (
        (point.x * 1000.0).round() as i64,
        (point.y * 1000.0).round() as i64,
    )
}

fn segment_intersection(first: (Key, Key), second: (Key, Key)) -> Option<Key> {
    let (a, b) = first;
    let (c, d) = second;
    let first_horizontal = a.1 == b.1;
    let second_horizontal = c.1 == d.1;
    if first_horizontal == second_horizontal {
        return None;
    }
    let (horizontal, vertical) = if first_horizontal {
        ((a, b), (c, d))
    } else {
        ((c, d), (a, b))
    };
    let point = (vertical.0 .0, horizontal.0 .1);
    (on_segment(point, horizontal.0, horizontal.1) && on_segment(point, vertical.0, vertical.1))
        .then_some(point)
}

fn absolute_pin(component: &Component, pin: Point) -> Point {
    let angle = component.rotation.rem_euclid(360);
    let rotated = match angle {
        90 => Point {
            x: -pin.y,
            y: pin.x,
        },
        180 => Point {
            x: -pin.x,
            y: -pin.y,
        },
        270 => Point {
            x: pin.y,
            y: -pin.x,
        },
        _ => pin,
    };
    Point {
        x: component.position.x + rotated.x,
        y: component.position.y + rotated.y,
    }
}

#[derive(Default)]
struct UnionFind {
    parent: HashMap<Key, Key>,
}
impl UnionFind {
    fn add(&mut self, value: Key) {
        self.parent.entry(value).or_insert(value);
    }
    fn find(&mut self, value: Key) -> Key {
        let parent = *self.parent.get(&value).unwrap_or(&value);
        if parent == value {
            value
        } else {
            let root = self.find(parent);
            self.parent.insert(value, root);
            root
        }
    }
    fn union(&mut self, a: Key, b: Key) {
        self.add(a);
        self.add(b);
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent.insert(rb, ra);
        }
    }
}

fn invalid_value(value: &str) -> bool {
    value.is_empty()
        || value.len() > 128
        || value.chars().any(|c| {
            c == '\n'
                || c == '\r'
                || c == ';'
                || !(c.is_ascii_alphanumeric() || " .,+-*/()_".contains(c))
        })
}

fn check_category(code: &str) -> &'static str {
    match code {
        "missing_ground" => "ground",
        "floating_label" | "invalid_label" | "conflicting_labels" => "labels",
        "unknown_probe" | "invalid_probe" => "probes",
        "invalid_analysis" => "analysis",
        _ => "pins",
    }
}

pub fn check(project: &Project) -> SimulationCheckReport {
    let (netlist, errors) = match generate(project) {
        Ok(netlist) => (Some(netlist), vec![]),
        Err(errors) => (None, errors),
    };
    let issues: Vec<_> = errors
        .into_iter()
        .map(|error| SimulationCheckIssue {
            code: error.code,
            category: check_category(error.code),
            message: error.message,
            component_id: error.component_id,
        })
        .collect();
    let checks = ["ground", "pins", "labels", "probes", "analysis"]
        .into_iter()
        .map(|category| {
            let issue_count = issues
                .iter()
                .filter(|issue| issue.category == category)
                .count();
            SimulationCheckItem {
                category,
                passed: issue_count == 0,
                issue_count,
            }
        })
        .collect();
    SimulationCheckReport {
        ready: issues.is_empty(),
        checks,
        issues,
        netlist,
    }
}

fn validate_probes(
    profile: &SimulationProfile,
    nodes: &BTreeSet<String>,
    references: &BTreeSet<String>,
) -> Vec<NetlistError> {
    let mut errors = vec![];
    for signal in &profile.signals {
        let normalized = signal.trim().to_ascii_lowercase();
        if let Some(arguments) = normalized
            .strip_prefix("v(")
            .and_then(|value| value.strip_suffix(')'))
        {
            let requested: Vec<_> = arguments.split(',').map(str::trim).collect();
            if requested.is_empty()
                || requested.len() > 2
                || requested.iter().any(|node| node.is_empty())
            {
                errors.push(NetlistError {
                    code: "invalid_probe",
                    message: format!(
                        "Invalid voltage probe '{signal}'. Use v(label) or v(label_a,label_b)"
                    ),
                    component_id: None,
                });
                continue;
            }
            for node in requested {
                if !nodes.contains(node) {
                    errors.push(NetlistError {
                        code: "unknown_probe",
                        message: format!(
                            "Probe '{signal}' references unknown or disconnected node '{node}'. Move a matching network label onto the green pin or connected wire"
                        ),
                        component_id: None,
                    });
                }
            }
        } else if let Some(reference) = normalized
            .strip_prefix("i(")
            .and_then(|value| value.strip_suffix(')'))
        {
            if reference.is_empty() || !references.contains(reference) {
                errors.push(NetlistError {
                    code: "unknown_probe",
                    message: format!(
                        "Probe '{signal}' references unknown component '{reference}'. Use an existing SPICE reference such as i(v1)"
                    ),
                    component_id: None,
                });
            }
        } else {
            errors.push(NetlistError {
                code: "invalid_probe",
                message: format!(
                    "Unsupported probe '{signal}'. Use v(label), v(label_a,label_b), or i(v1)"
                ),
                component_id: None,
            });
        }
    }
    errors
}

pub fn generate(project: &Project) -> Result<String, Vec<NetlistError>> {
    crate::project::validate(project).map_err(|error| {
        vec![NetlistError {
            code: "invalid_project",
            message: error.to_string(),
            component_id: None,
        }]
    })?;
    let sheet = project.sheets.first().ok_or_else(|| {
        vec![NetlistError {
            code: "no_sheet",
            message: "Project has no schematic sheet".into(),
            component_id: None,
        }]
    })?;
    let mut errors = validate_components(project, sheet);
    let profile = project.active_simulation_profile.and_then(|id| {
        project
            .simulation_profiles
            .iter()
            .find(|profile| profile.id == id)
    });
    if profile.is_none_or(|profile| !valid_analysis(&profile.analysis)) {
        errors.push(NetlistError { code: "invalid_analysis", message: "Choose a valid analysis: positive time/frequency range and step, or a DC sweep directed toward its stop value".into(), component_id: None });
    }
    let mut uf = UnionFind::default();
    let mut pins: Vec<(Uuid, String, Key, bool)> = vec![];
    let mut all_points = BTreeSet::new();

    for component in &sheet.components {
        if component.kind == ComponentKind::NetLabel {
            let position = key(component.position);
            uf.add(position);
            all_points.insert(position);
            continue;
        }
        for pin in &component.pins {
            let position = key(absolute_pin(component, pin.offset));
            uf.add(position);
            all_points.insert(position);
            pins.push((
                component.id,
                pin.id.clone(),
                position,
                component.kind == ComponentKind::Ground,
            ));
        }
    }
    for label in &sheet.net_labels {
        let p = key(label.position);
        uf.add(p);
        all_points.insert(p);
    }
    for wire in &sheet.wires {
        for point in &wire.points {
            let p = key(*point);
            uf.add(p);
            all_points.insert(p);
        }
    }
    let segments: Vec<_> = sheet
        .wires
        .iter()
        .flat_map(|wire| {
            wire.points
                .windows(2)
                .map(|segment| (key(segment[0]), key(segment[1])))
        })
        .collect();
    let horizontal: Vec<_> = segments
        .iter()
        .copied()
        .filter(|(a, b)| a.1 == b.1)
        .collect();
    let mut vertical: Vec<_> = segments
        .iter()
        .copied()
        .filter(|(a, b)| a.0 == b.0 && a.1 != b.1)
        .collect();
    vertical.sort_by_key(|(a, _)| a.0);
    for segment in horizontal {
        let left = segment.0 .0.min(segment.1 .0);
        let right = segment.0 .0.max(segment.1 .0);
        let start = vertical.partition_point(|(a, _)| a.0 < left);
        for candidate in vertical[start..].iter().take_while(|(a, _)| a.0 <= right) {
            if let Some(point) = segment_intersection(segment, *candidate) {
                uf.add(point);
                all_points.insert(point);
            }
        }
    }
    let mut points_by_x: HashMap<i64, Vec<Key>> = HashMap::new();
    let mut points_by_y: HashMap<i64, Vec<Key>> = HashMap::new();
    for &point in &all_points {
        points_by_x.entry(point.0).or_default().push(point);
        points_by_y.entry(point.1).or_default().push(point);
    }
    for wire in &sheet.wires {
        for segment in wire.points.windows(2) {
            let a = key(segment[0]);
            let b = key(segment[1]);
            uf.union(a, b);
            let aligned_points = if a.1 == b.1 {
                points_by_y.get(&a.1)
            } else {
                points_by_x.get(&a.0)
            };
            for &p in aligned_points.into_iter().flatten() {
                if on_segment(p, a, b) {
                    uf.union(a, p);
                }
            }
        }
    }
    let mut ground_roots = BTreeSet::new();
    for (_, _, p, ground) in &pins {
        if *ground {
            ground_roots.insert(uf.find(*p));
        }
    }
    if ground_roots.is_empty() {
        errors.push(NetlistError {
            code: "missing_ground",
            message: "Schematic requires a ground reference".into(),
            component_id: None,
        });
    }

    let mut labels = BTreeMap::new();
    for label in &sheet.net_labels {
        if !crate::models::identifier(&label.name) {
            errors.push(NetlistError {
                code: "invalid_label",
                message: format!("Invalid net label '{}'", label.name),
                component_id: None,
            });
        } else {
            let root = uf.find(key(label.position));
            if let Some(previous) = labels.insert(root, label.name.trim().to_owned()) {
                if previous != label.name.trim() {
                    errors.push(NetlistError {
                        code: "conflicting_labels",
                        message: format!(
                            "Net has conflicting labels '{previous}' and '{}'",
                            label.name
                        ),
                        component_id: None,
                    });
                }
            }
        }
    }
    for component in sheet
        .components
        .iter()
        .filter(|c| c.kind == ComponentKind::NetLabel)
    {
        let name = component
            .parameters
            .get("value")
            .map(String::as_str)
            .unwrap_or("");
        if !crate::models::identifier(name) {
            errors.push(NetlistError {
                code: "invalid_label",
                message: format!("Invalid net label '{name}'"),
                component_id: Some(component.id),
            });
        } else {
            let root = uf.find(key(component.position));
            if let Some(previous) = labels.insert(root, name.trim().to_owned()) {
                if previous != name.trim() {
                    errors.push(NetlistError {
                        code: "conflicting_labels",
                        message: format!("Net has conflicting labels '{previous}' and '{name}'"),
                        component_id: Some(component.id),
                    });
                }
            }
        }
    }

    let mut pin_counts: BTreeMap<Key, usize> = BTreeMap::new();
    for (_, _, p, _) in &pins {
        *pin_counts.entry(uf.find(*p)).or_default() += 1;
    }
    for (component_id, pin_id, p, ground) in &pins {
        if !ground && pin_counts.get(&uf.find(*p)).copied().unwrap_or(0) < 2 {
            errors.push(NetlistError {
                code: "floating_pin",
                message: format!("Pin {pin_id} is not electrically connected"),
                component_id: Some(*component_id),
            });
        }
    }
    let pin_roots: BTreeSet<Key> = pins.iter().map(|(_, _, p, _)| uf.find(*p)).collect();
    for label in &sheet.net_labels {
        if !pin_roots.contains(&uf.find(key(label.position))) {
            errors.push(NetlistError {
                code: "floating_label",
                message: format!(
                    "Network label '{}' is not attached to a component pin or wire. Move it onto the green pin or connected wire",
                    label.name
                ),
                component_id: None,
            });
        }
    }
    for component in sheet
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::NetLabel)
    {
        if !pin_roots.contains(&uf.find(key(component.position))) {
            let name = component
                .parameters
                .get("value")
                .map(String::as_str)
                .unwrap_or("");
            errors.push(NetlistError {
                code: "floating_label",
                message: format!(
                    "Network label '{name}' is not attached to a component pin or wire. Move it onto the green pin or connected wire"
                ),
                component_id: Some(component.id),
            });
        }
    }
    if let Some(profile) = profile {
        let mut known_nodes = BTreeSet::from(["0".to_owned()]);
        for (root, name) in &labels {
            if pin_roots.contains(root) {
                known_nodes.insert(name.trim().to_ascii_lowercase());
            }
        }
        let references = sheet
            .components
            .iter()
            .filter(|component| !component.spice_ref.is_empty())
            .map(|component| component.spice_ref.to_ascii_lowercase())
            .collect();
        errors.extend(validate_probes(profile, &known_nodes, &references));
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let roots: BTreeSet<Key> = pins.iter().map(|(_, _, p, _)| uf.find(*p)).collect();
    let mut unnamed = BTreeMap::new();
    let mut sequence = 1;
    for root in roots {
        if !ground_roots.contains(&root) && !labels.contains_key(&root) {
            unnamed.insert(root, format!("n{sequence:03}"));
            sequence += 1;
        }
    }
    let node = |uf: &mut UnionFind, p: Key| {
        let root = uf.find(p);
        if ground_roots.contains(&root) {
            "0".into()
        } else {
            labels
                .get(&root)
                .cloned()
                .or_else(|| unnamed.get(&root).cloned())
                .unwrap_or_else(|| "NC".into())
        }
    };

    let mut devices: Vec<&Component> = sheet
        .components
        .iter()
        .filter(|c| !matches!(c.kind, ComponentKind::Ground | ComponentKind::NetLabel))
        .collect();
    devices.sort_by(|a, b| a.spice_ref.cmp(&b.spice_ref));
    let mut lines = vec![format!(
        "* SugarEDA — {}",
        project.metadata.name.replace(['\n', '\r'], " ")
    )];
    let used_libraries: BTreeSet<_> = devices
        .iter()
        .filter_map(|component| component.model.as_ref().map(|model| model.library_id))
        .collect();
    for library in &project.spice_libraries {
        if used_libraries.contains(&library.id) {
            lines.push(format!(
                "* Embedded model library: {} ({})",
                library.name.replace(['\n', '\r'], " "),
                library.sha256
            ));
            lines.extend(library.content.lines().map(str::to_owned));
        }
    }
    for component in devices {
        let mut nodes: Vec<String> = component
            .pins
            .iter()
            .map(|p| node(&mut uf, key(absolute_pin(component, p.offset))))
            .collect();
        let value = if let Some(model) = &component.model {
            if component.kind == ComponentKind::Mosfet && nodes.len() == 3 {
                nodes.push(nodes[2].clone());
            }
            model.model_name.clone()
        } else {
            component
                .parameters
                .get("value")
                .cloned()
                .unwrap_or_default()
        };
        lines.push(format!(
            "{} {} {}",
            component.spice_ref,
            nodes.join(" "),
            value
        ));
    }
    let profile = project
        .active_simulation_profile
        .and_then(|id| project.simulation_profiles.iter().find(|p| p.id == id))
        .or_else(|| project.simulation_profiles.first());
    if let Some(profile) = profile {
        lines.push(analysis_line(&profile.analysis));
    }
    lines.push(".end".into());
    Ok(lines.join("\n"))
}

fn on_segment(p: Key, a: Key, b: Key) -> bool {
    let cross = (p.0 - a.0) * (b.1 - a.1) - (p.1 - a.1) * (b.0 - a.0);
    cross == 0
        && p.0 >= a.0.min(b.0)
        && p.0 <= a.0.max(b.0)
        && p.1 >= a.1.min(b.1)
        && p.1 <= a.1.max(b.1)
}

fn analysis_line(analysis: &Analysis) -> String {
    match analysis {
        Analysis::OperatingPoint => ".op".into(),
        Analysis::Transient { step, stop } => format!(".tran {step} {stop}"),
        Analysis::DcSweep {
            source,
            start,
            stop,
            step,
        } => format!(".dc {source} {start} {stop} {step}"),
        Analysis::AcSweep {
            variation,
            points,
            start,
            stop,
        } => format!(".ac {variation} {points} {start} {stop}"),
    }
}

fn validate_components(project: &Project, sheet: &SchematicSheet) -> Vec<NetlistError> {
    let mut errors = vec![];
    let mut refs = BTreeSet::new();
    let mut exported = BTreeSet::new();
    for library in &project.spice_libraries {
        for model in &library.models {
            if !exported.insert(model.name.to_ascii_lowercase()) {
                errors.push(NetlistError {
                    code: "duplicate_model",
                    message: format!("Duplicate model name '{}' across libraries", model.name),
                    component_id: None,
                });
            }
        }
    }
    for component in &sheet.components {
        if matches!(
            component.kind,
            ComponentKind::Ground | ComponentKind::NetLabel
        ) {
            continue;
        }
        if component.spice_ref.is_empty()
            || !component.spice_ref.starts_with(component.kind.prefix())
            || !component
                .spice_ref
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            errors.push(NetlistError {
                code: "invalid_reference",
                message: format!("Invalid reference '{}'", component.spice_ref),
                component_id: Some(component.id),
            });
        } else if !refs.insert(component.spice_ref.to_ascii_uppercase()) {
            errors.push(NetlistError {
                code: "duplicate_reference",
                message: format!("Duplicate reference '{}'", component.spice_ref),
                component_id: Some(component.id),
            });
        }
        if let Some(model) = &component.model {
            let definition = project
                .spice_libraries
                .iter()
                .find(|library| library.id == model.library_id)
                .and_then(|library| {
                    library
                        .models
                        .iter()
                        .find(|definition| definition.name.eq_ignore_ascii_case(&model.model_name))
                });
            let expected_kind = match model.kind {
                crate::domain::SpiceModelKind::Diode => ComponentKind::Diode,
                crate::domain::SpiceModelKind::Bipolar => ComponentKind::BipolarTransistor,
                crate::domain::SpiceModelKind::Mosfet => ComponentKind::Mosfet,
                crate::domain::SpiceModelKind::Subcircuit => ComponentKind::Subcircuit,
            };
            if definition.is_none_or(|definition| {
                definition.kind != model.kind
                    || component.kind != expected_kind
                    || definition.pins.len() != component.pins.len()
                    || definition
                        .pins
                        .iter()
                        .zip(&component.pins)
                        .any(|(name, pin)| name != &pin.name)
            }) {
                errors.push(NetlistError {
                    code: "missing_model",
                    message: format!(
                        "Model '{}' for {} is unavailable or its pin mapping is invalid",
                        model.model_name, component.spice_ref
                    ),
                    component_id: Some(component.id),
                });
            }
        } else {
            if matches!(
                component.kind,
                ComponentKind::Diode
                    | ComponentKind::BipolarTransistor
                    | ComponentKind::Mosfet
                    | ComponentKind::Subcircuit
            ) || component.pins.len() != 2
            {
                errors.push(NetlistError {
                    code: "invalid_pins",
                    message: format!(
                        "{} needs a model binding or exactly two pins",
                        component.spice_ref
                    ),
                    component_id: Some(component.id),
                });
            }
            let value = component
                .parameters
                .get("value")
                .map(String::as_str)
                .unwrap_or("");
            if invalid_value(value) {
                errors.push(NetlistError {
                    code: "invalid_parameter",
                    message: format!("Invalid value for {}", component.spice_ref),
                    component_id: Some(component.id),
                });
            }
        }
    }
    errors
}

pub fn spice_number(value: &str) -> Option<f64> {
    let value = value.trim().to_ascii_lowercase();
    if let Ok(number) = value.parse::<f64>() {
        return number.is_finite().then_some(number);
    }
    for (suffix, scale) in [
        ("meg", 1e6),
        ("t", 1e12),
        ("g", 1e9),
        ("k", 1e3),
        ("m", 1e-3),
        ("u", 1e-6),
        ("n", 1e-9),
        ("p", 1e-12),
        ("f", 1e-15),
    ] {
        if let Some(prefix) = value.strip_suffix(suffix) {
            let number = prefix.parse::<f64>().ok()? * scale;
            return number.is_finite().then_some(number);
        }
    }
    None
}

fn valid_analysis(analysis: &Analysis) -> bool {
    match analysis {
        Analysis::OperatingPoint => true,
        Analysis::Transient { step, stop } => {
            matches!((spice_number(step),spice_number(stop)), (Some(a),Some(b)) if a > 0.0 && b >= a && b/a <= 1_000_000.0)
        }
        Analysis::DcSweep {
            source,
            start,
            stop,
            step,
        } => {
            crate::models::identifier(source)
                && matches!((spice_number(start),spice_number(stop),spice_number(step)), (Some(a),Some(b),Some(c)) if c != 0.0 && (b-a)/c > 0.0 && (b-a)/c <= 1_000_000.0)
        }
        Analysis::AcSweep {
            variation,
            points,
            start,
            stop,
        } => {
            matches!(variation.as_str(), "dec" | "oct" | "lin")
                && *points > 0
                && *points <= 10_000
                && matches!((spice_number(start),spice_number(stop)), (Some(a),Some(b)) if a > 0.0 && b > a)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn perpendicular_wire_segments_create_an_electrical_junction() {
        assert_eq!(
            segment_intersection(((0, 40), (100, 40)), ((60, 0), (60, 80))),
            Some((60, 40))
        );
    }

    #[test]
    fn rc_is_deterministic() {
        let p = crate::domain::test_rc_project();
        let a = generate(&p).unwrap();
        assert_eq!(a, generate(&p).unwrap());
        assert!(a.contains("V1 in 0 PULSE(0 5 0 1u 1u 5m 10m)"));
        assert!(a.contains("R1 in out 1k"));
        assert!(a.contains("C1 out 0 1u"));
        assert!(a.contains(".tran 10u 30m"));
    }
    #[test]
    fn simulation_check_returns_five_passing_categories_and_the_netlist() {
        let report = check(&crate::domain::test_rc_project());
        assert!(report.ready);
        assert_eq!(report.checks.len(), 5);
        assert!(report.checks.iter().all(|item| item.passed));
        assert!(report.netlist.is_some());
    }
    #[test]
    fn open_circuit_is_rejected() {
        let mut p = crate::domain::test_rc_project();
        p.sheets[0].wires.remove(0);
        let e = generate(&p).unwrap_err();
        assert!(e.iter().any(|e| e.code == "floating_pin"));
    }
    #[test]
    fn duplicate_reference_is_rejected() {
        let mut p = crate::domain::test_rc_project();
        p.sheets[0].components[1].spice_ref = "V1".into();
        let e = generate(&p).unwrap_err();
        assert!(e
            .iter()
            .any(|e| e.code == "invalid_reference" || e.code == "duplicate_reference"));
    }
    #[test]
    fn missing_ground_is_rejected() {
        let mut p = crate::domain::test_rc_project();
        p.sheets[0]
            .components
            .retain(|c| c.kind != ComponentKind::Ground);
        let e = generate(&p).unwrap_err();
        assert!(e.iter().any(|e| e.code == "missing_ground"));
    }
    #[test]
    fn rejects_spice_injection() {
        let mut p = crate::domain::test_rc_project();
        p.sheets[0].components[1]
            .parameters
            .insert("value".into(), "1k\n.control".into());
        assert!(generate(&p).is_err());
    }
    #[test]
    fn disconnected_network_label_is_rejected_before_simulation() {
        let mut p = crate::domain::test_rc_project();
        p.sheets[0].net_labels[0].position.y -= 10.0;
        let errors = generate(&p).unwrap_err();
        assert!(errors.iter().any(|error| error.code == "floating_label"));
        assert!(errors.iter().any(|error| error.code == "unknown_probe"));
    }
    #[test]
    fn unknown_probe_is_rejected_before_simulation() {
        let mut p = crate::domain::test_rc_project();
        p.simulation_profiles[0].signals = vec!["v(missing)".into()];
        let errors = generate(&p).unwrap_err();
        assert!(errors.iter().any(|error| error.code == "unknown_probe"));
    }
}
