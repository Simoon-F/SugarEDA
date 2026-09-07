//! Explicit cross-sheet connectivity and deterministic hierarchy expansion.

use crate::domain::{
    Component, ComponentKind, NetLabel, Pin, PinElectricalType, Point, Project, SchematicSheet,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use uuid::Uuid;

pub const TARGET_SHEET_ID: &str = "targetSheetId";
pub const PORT_DIRECTION: &str = "direction";
const MAX_HIERARCHY_DEPTH: usize = 32;

pub fn is_label(kind: &ComponentKind) -> bool {
    matches!(kind, ComponentKind::NetLabel | ComponentKind::GlobalLabel)
}

pub fn connector_name(component: &Component) -> &str {
    component
        .parameters
        .get("value")
        .map(String::as_str)
        .unwrap_or("")
}

pub fn add_sheet_instance(
    project: &mut Project,
    target_sheet_id: Uuid,
    position: Point,
) -> Result<Uuid, String> {
    let owner_id = project.ui_view_state.active_sheet_id;
    if owner_id == target_sheet_id {
        return Err("A schematic sheet cannot instantiate itself".into());
    }
    let target = project
        .sheets
        .iter()
        .find(|sheet| sheet.id == target_sheet_id)
        .ok_or_else(|| format!("Target schematic sheet {target_sheet_id} does not exist"))?;
    let id = Uuid::new_v4();
    let mut parameters = BTreeMap::new();
    parameters.insert(TARGET_SHEET_ID.into(), target_sheet_id.to_string());
    parameters.insert("value".into(), target.name.clone());
    let component = Component {
        id,
        kind: ComponentKind::SheetInstance,
        position,
        rotation: 0,
        parameters,
        pins: instance_pins(target),
        display_name: target.name.clone(),
        spice_ref: String::new(),
        model: None,
        device: None,
        symbol_width: Some(160.0),
        symbol_height: Some(instance_height(target)),
    };
    crate::schematic_sheet::active_mut(project)?
        .components
        .push(component);
    if let Err(error) = validate(project) {
        // Keep this helper transactional because callers may return immediately on
        // validation errors before the workspace-level snapshot can be restored.
        for sheet in &mut project.sheets {
            sheet.components.retain(|candidate| candidate.id != id);
        }
        return Err(error);
    }
    Ok(id)
}

pub fn synchronize(project: &mut Project) -> Result<(), String> {
    let targets: HashMap<_, _> = project
        .sheets
        .iter()
        .map(|sheet| {
            (
                sheet.id,
                (
                    sheet.name.clone(),
                    instance_pins(sheet),
                    instance_height(sheet),
                ),
            )
        })
        .collect();
    for component in project
        .sheets
        .iter_mut()
        .flat_map(|sheet| &mut sheet.components)
        .filter(|component| component.kind == ComponentKind::SheetInstance)
    {
        let target_id = parse_target(component)?;
        let (name, pins, height) = targets
            .get(&target_id)
            .ok_or_else(|| format!("Sheet instance references missing sheet {target_id}"))?;
        component.pins = pins.clone();
        component.parameters.insert("value".into(), name.clone());
        component.display_name = name.clone();
        component.symbol_width = Some(160.0);
        component.symbol_height = Some(*height);
    }
    validate(project)
}

pub fn validate(project: &Project) -> Result<(), String> {
    let sheet_ids: HashSet<_> = project.sheets.iter().map(|sheet| sheet.id).collect();
    let mut target_owners = HashMap::new();
    let mut edges: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for sheet in &project.sheets {
        let mut port_names = HashSet::new();
        for component in &sheet.components {
            match component.kind {
                ComponentKind::NetLabel | ComponentKind::GlobalLabel => {
                    validate_identifier(connector_name(component), "network label")?;
                }
                ComponentKind::HierarchicalPort => {
                    validate_identifier(connector_name(component), "hierarchical port")?;
                    if !port_names.insert(connector_name(component).to_ascii_lowercase()) {
                        return Err(format!(
                            "Sheet '{}' contains duplicate hierarchical port '{}'",
                            sheet.name,
                            connector_name(component)
                        ));
                    }
                    if !matches!(
                        component.parameters.get(PORT_DIRECTION).map(String::as_str),
                        Some("input" | "output" | "bidirectional" | "passive")
                    ) {
                        return Err(format!(
                            "Hierarchical port '{}' has an invalid direction",
                            connector_name(component)
                        ));
                    }
                }
                ComponentKind::SheetInstance => {
                    let target = parse_target(component)?;
                    if target == sheet.id {
                        return Err(format!("Sheet '{}' cannot instantiate itself", sheet.name));
                    }
                    let target_sheet = project
                        .sheets
                        .iter()
                        .find(|candidate| candidate.id == target)
                        .ok_or_else(|| {
                            format!("Sheet instance references missing sheet {target}")
                        })?;
                    if target_owners.insert(target, sheet.id).is_some() {
                        return Err(format!("Sheet {target} is instantiated more than once"));
                    }
                    if component.pins != instance_pins(target_sheet) {
                        return Err(format!(
                            "Sheet instance '{}' has stale or modified port bindings",
                            component.display_name
                        ));
                    }
                    edges.entry(sheet.id).or_default().push(target);
                }
                _ => {}
            }
        }
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for sheet_id in sheet_ids {
        visit(sheet_id, &edges, &mut visiting, &mut visited, 0)?;
    }
    Ok(())
}

pub fn flatten_for_analysis(
    project: &Project,
    root_sheet_id: Uuid,
) -> Result<SchematicSheet, String> {
    let mut included = HashSet::from([root_sheet_id]);
    loop {
        let before = included.len();
        let global_names: HashSet<_> = project
            .sheets
            .iter()
            .filter(|sheet| included.contains(&sheet.id))
            .flat_map(|sheet| {
                sheet
                    .components
                    .iter()
                    .filter(|component| component.kind == ComponentKind::GlobalLabel)
                    .map(|component| connector_name(component).to_ascii_lowercase())
            })
            .collect();
        for sheet in &project.sheets {
            if included.contains(&sheet.id)
                || sheet.components.iter().any(|component| {
                    component.kind == ComponentKind::GlobalLabel
                        && global_names.contains(&connector_name(component).to_ascii_lowercase())
                })
            {
                included.insert(sheet.id);
            }
        }
        let child_ids: Vec<_> = project
            .sheets
            .iter()
            .filter(|sheet| included.contains(&sheet.id))
            .flat_map(|sheet| &sheet.components)
            .filter(|component| component.kind == ComponentKind::SheetInstance)
            .map(parse_target)
            .collect::<Result<_, _>>()?;
        included.extend(child_ids);
        if included.len() == before {
            break;
        }
    }
    flatten(project, &included, root_sheet_id)
}

pub fn flatten_for_erc(project: &Project) -> Result<SchematicSheet, String> {
    let included = project.sheets.iter().map(|sheet| sheet.id).collect();
    flatten(project, &included, project.ui_view_state.active_sheet_id)
}

fn flatten(
    project: &Project,
    included: &HashSet<Uuid>,
    root_sheet_id: Uuid,
) -> Result<SchematicSheet, String> {
    validate(project)?;
    let mut result = SchematicSheet {
        id: root_sheet_id,
        name: project
            .sheets
            .iter()
            .find(|sheet| sheet.id == root_sheet_id)
            .map(|sheet| sheet.name.clone())
            .unwrap_or_else(|| "Hierarchy".into()),
        components: Vec::new(),
        wires: Vec::new(),
        net_labels: Vec::new(),
    };
    let offsets: HashMap<_, _> = project
        .sheets
        .iter()
        .filter(|sheet| included.contains(&sheet.id))
        .enumerate()
        .map(|(index, sheet)| {
            (
                sheet.id,
                Point {
                    x: index as f64 * 1_000_000.0,
                    y: index as f64 * 1_000_000.0,
                },
            )
        })
        .collect();
    let mut port_links = HashMap::new();
    for sheet in project
        .sheets
        .iter()
        .filter(|sheet| included.contains(&sheet.id))
    {
        for instance in sheet
            .components
            .iter()
            .filter(|component| component.kind == ComponentKind::SheetInstance)
        {
            let target = parse_target(instance)?;
            if !included.contains(&target) {
                continue;
            }
            for pin in &instance.pins {
                let alias = hierarchy_alias(instance.id, &pin.id);
                port_links.insert((target, pin.id.clone()), alias.clone());
                result.net_labels.push(NetLabel {
                    id: Uuid::new_v4(),
                    name: alias,
                    position: translated(absolute_pin(instance, pin.offset), offsets[&sheet.id]),
                });
            }
        }
    }
    for sheet in project
        .sheets
        .iter()
        .filter(|sheet| included.contains(&sheet.id))
    {
        let offset = offsets[&sheet.id];
        for source in &sheet.components {
            match source.kind {
                ComponentKind::SheetInstance => {}
                ComponentKind::HierarchicalPort => {
                    let alias = port_links
                        .get(&(sheet.id, source.id.to_string()))
                        .cloned()
                        .unwrap_or_else(|| hierarchy_alias(sheet.id, &source.id.to_string()));
                    result.net_labels.push(NetLabel {
                        id: Uuid::new_v4(),
                        name: alias,
                        position: translated(source.position, offset),
                    });
                }
                ComponentKind::GlobalLabel => {
                    let mut component = source.clone();
                    component.kind = ComponentKind::NetLabel;
                    component.position = translated(component.position, offset);
                    result.components.push(component);
                }
                ComponentKind::NetLabel => {
                    let mut component = source.clone();
                    component.position = translated(component.position, offset);
                    if sheet.id != root_sheet_id {
                        namespace_local_label(&mut component, sheet.id);
                    }
                    result.components.push(component);
                }
                _ => {
                    let mut component = source.clone();
                    component.position = translated(component.position, offset);
                    result.components.push(component);
                }
            }
        }
        result
            .wires
            .extend(sheet.wires.iter().cloned().map(|mut wire| {
                wire.points = wire
                    .points
                    .into_iter()
                    .map(|point| translated(point, offset))
                    .collect();
                wire
            }));
        result
            .net_labels
            .extend(sheet.net_labels.iter().cloned().map(|mut label| {
                label.position = translated(label.position, offset);
                if sheet.id != root_sheet_id {
                    label.name = local_alias(sheet.id, &label.name);
                }
                label
            }));
    }
    Ok(result)
}

fn instance_pins(sheet: &SchematicSheet) -> Vec<Pin> {
    let ports: Vec<_> = sheet
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::HierarchicalPort)
        .collect();
    let side_totals = [
        ports
            .iter()
            .filter(|port| {
                port.parameters.get(PORT_DIRECTION).map(String::as_str) != Some("output")
            })
            .count(),
        ports
            .iter()
            .filter(|port| {
                port.parameters.get(PORT_DIRECTION).map(String::as_str) == Some("output")
            })
            .count(),
    ];
    let mut side_counts = [0usize; 2];
    ports
        .iter()
        .map(|port| {
            let direction = port
                .parameters
                .get(PORT_DIRECTION)
                .map(String::as_str)
                .unwrap_or("bidirectional");
            let side = usize::from(direction == "output");
            let index = side_counts[side];
            side_counts[side] += 1;
            Pin {
                id: port.id.to_string(),
                name: connector_name(port).to_owned(),
                offset: Point {
                    x: if side == 0 { -100.0 } else { 100.0 },
                    y: (index as f64 - (side_totals[side].saturating_sub(1) as f64 / 2.0)) * 24.0
                        + 8.0,
                },
                electrical_type: Some(match direction {
                    "input" => PinElectricalType::Input,
                    "output" => PinElectricalType::Output,
                    "passive" => PinElectricalType::Passive,
                    _ => PinElectricalType::Bidirectional,
                }),
                direction: Some(direction.into()),
                allow_floating: true,
                ..Pin::default()
            }
        })
        .collect()
}

fn instance_height(sheet: &SchematicSheet) -> f64 {
    let count = sheet
        .components
        .iter()
        .filter(|component| component.kind == ComponentKind::HierarchicalPort)
        .count();
    (count.max(2) as f64 * 24.0 + 32.0).max(80.0)
}

fn parse_target(component: &Component) -> Result<Uuid, String> {
    component
        .parameters
        .get(TARGET_SHEET_ID)
        .ok_or_else(|| "Sheet instance is missing targetSheetId".to_owned())?
        .parse()
        .map_err(|_| "Sheet instance targetSheetId is invalid".to_owned())
}

fn validate_identifier(value: &str, kind: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().enumerate().all(|(index, character)| {
            character == '_'
                || character.is_ascii_alphanumeric() && (index > 0 || !character.is_ascii_digit())
        })
    {
        return Err(format!("Invalid {kind} name '{value}'"));
    }
    Ok(())
}

fn visit(
    id: Uuid,
    edges: &HashMap<Uuid, Vec<Uuid>>,
    visiting: &mut HashSet<Uuid>,
    visited: &mut HashSet<Uuid>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_HIERARCHY_DEPTH {
        return Err(format!("Hierarchy exceeds {MAX_HIERARCHY_DEPTH} levels"));
    }
    if visited.contains(&id) {
        return Ok(());
    }
    if !visiting.insert(id) {
        return Err("Schematic hierarchy contains a cycle".into());
    }
    for child in edges.get(&id).into_iter().flatten() {
        visit(*child, edges, visiting, visited, depth + 1)?;
    }
    visiting.remove(&id);
    visited.insert(id);
    Ok(())
}

fn translated(point: Point, offset: Point) -> Point {
    Point {
        x: point.x + offset.x,
        y: point.y + offset.y,
    }
}

fn absolute_pin(component: &Component, offset: Point) -> Point {
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
    Point {
        x: component.position.x + rotated.x,
        y: component.position.y + rotated.y,
    }
}

fn namespace_local_label(component: &mut Component, sheet_id: Uuid) {
    if let Some(name) = component.parameters.get_mut("value") {
        *name = local_alias(sheet_id, name);
    }
}

fn local_alias(sheet_id: Uuid, name: &str) -> String {
    format!("l_{}_{}", sheet_id.simple(), name)
}

fn hierarchy_alias(instance_id: Uuid, port_id: &str) -> String {
    format!("h_{}_{}", instance_id.simple(), port_id.replace('-', "_"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::component;

    #[test]
    fn sheet_instance_tracks_child_ports_and_rejects_cycles() {
        let mut project = Project::blank("hierarchy");
        let root = project.sheets[0].id;
        let child = crate::schematic_sheet::add(&mut project, "Child".into()).unwrap();
        project.sheets[1].components.push(component(
            ComponentKind::HierarchicalPort,
            40.0,
            40.0,
            "",
            "VIN",
        ));
        crate::schematic_sheet::select(&mut project, root).unwrap();
        add_sheet_instance(&mut project, child, Point { x: 100.0, y: 100.0 }).unwrap();
        assert_eq!(project.sheets[0].components[0].pins[0].name, "VIN");
        let flat = flatten_for_analysis(&project, root).unwrap();
        let aliases: Vec<_> = flat
            .net_labels
            .iter()
            .filter(|label| label.name.starts_with("h_"))
            .map(|label| label.name.as_str())
            .collect();
        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases[0], aliases[1]);
        crate::schematic_sheet::select(&mut project, child).unwrap();
        assert!(add_sheet_instance(&mut project, root, Point::default()).is_err());
        assert!(project.sheets[1]
            .components
            .iter()
            .all(|component| component.kind != ComponentKind::SheetInstance));
    }

    #[test]
    fn flatten_namespaces_local_labels_but_preserves_global_labels() {
        let mut project = Project::blank("hierarchy");
        let root = project.sheets[0].id;
        project.sheets[0].components.push(component(
            ComponentKind::GlobalLabel,
            0.0,
            0.0,
            "",
            "VCC",
        ));
        crate::schematic_sheet::add(&mut project, "Power".into()).unwrap();
        project.sheets[1].components.push(component(
            ComponentKind::GlobalLabel,
            0.0,
            0.0,
            "",
            "VCC",
        ));
        project.sheets[1].components.push(component(
            ComponentKind::NetLabel,
            20.0,
            0.0,
            "",
            "sense",
        ));
        let flat = flatten_for_analysis(&project, root).unwrap();
        assert_eq!(
            flat.components
                .iter()
                .filter(|component| connector_name(component) == "VCC")
                .count(),
            2
        );
        assert!(flat.components.iter().any(|component| {
            connector_name(component).starts_with("l_")
                && connector_name(component).ends_with("_sense")
        }));
    }

    #[test]
    fn hierarchy_round_trips_with_port_identity_intact() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hierarchy.sugeda");
        let mut project = Project::blank("hierarchy");
        let root = project.sheets[0].id;
        let child = crate::schematic_sheet::add(&mut project, "Child".into()).unwrap();
        project.sheets[1].components.push(component(
            ComponentKind::HierarchicalPort,
            40.0,
            40.0,
            "",
            "DATA_IN",
        ));
        crate::schematic_sheet::select(&mut project, root).unwrap();
        add_sheet_instance(&mut project, child, Point { x: 100.0, y: 100.0 }).unwrap();
        crate::project::save(&path, &project).unwrap();
        assert_eq!(crate::project::load(&path).unwrap(), project);
    }
}
