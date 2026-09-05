use crate::device_pack::EmbeddedDevicePack;
use crate::domain::{
    component, modeled_component, Analysis, Component, ComponentKind, DeviceInstance, Point,
    Project, SimulationProfile, SpiceLibrary, Wire,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub project: Project,
    pub path: Option<String>,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

pub struct Workspace {
    pub project: Project,
    pub path: Option<PathBuf>,
    dirty: bool,
    undo: Vec<Project>,
    redo: Vec<Project>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EditorCommand {
    AddComponent {
        kind: ComponentKind,
        position: Point,
    },
    AddModelComponent {
        library_id: Uuid,
        model_name: String,
        position: Point,
    },
    AddDeviceComponent {
        pack_sha256: String,
        device_id: String,
        variant_id: Option<String>,
        unit_id: Option<String>,
        logical_instance_id: Option<Uuid>,
        position: Point,
    },
    MoveComponent {
        id: Uuid,
        position: Point,
    },
    MoveSelection {
        component_ids: Vec<Uuid>,
        wire_ids: Vec<Uuid>,
        delta: Point,
    },
    UpdateComponent {
        id: Uuid,
        display_name: String,
        spice_ref: String,
        value: String,
    },
    RotateComponent {
        id: Uuid,
    },
    SetPinNoConnect {
        component_id: Uuid,
        pin_id: String,
        no_connect: bool,
    },
    DeleteSelection {
        component_ids: Vec<Uuid>,
        wire_ids: Vec<Uuid>,
    },
    InsertSelection {
        components: Vec<Component>,
        wires: Vec<Wire>,
        device_instances: Vec<DeviceInstance>,
        #[serde(default)]
        board_configurations: Vec<crate::board_config::BoardConfiguration>,
    },
    AddWire {
        points: Vec<Point>,
    },
    UpdateWire {
        id: Uuid,
        points: Vec<Point>,
    },
    DeleteWire {
        id: Uuid,
    },
    UpdateView {
        zoom: f64,
        pan: Point,
        grid_visible: bool,
    },
    UpdateSimulation {
        profile: SimulationProfile,
    },
    AddSimulationProfile {
        profile: SimulationProfile,
    },
    DeleteSimulationProfile {
        id: Uuid,
    },
    SelectSimulationProfile {
        id: Uuid,
    },
    RemoveBoardConfiguration {
        id: Uuid,
    },
    RemoveDevicePack {
        pack_sha256: String,
    },
}

impl Workspace {
    pub fn new(project: Project) -> Self {
        Self {
            project,
            path: None,
            dirty: false,
            undo: vec![],
            redo: vec![],
        }
    }
    pub fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            project: self.project.clone(),
            path: self.path.as_ref().map(|p| p.display().to_string()),
            dirty: self.dirty,
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        }
    }
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }
    pub fn replace(&mut self, project: Project, path: Option<PathBuf>) {
        self.project = project;
        self.path = path;
        self.dirty = false;
        self.undo.clear();
        self.redo.clear();
    }
    pub fn restore(&mut self, project: Project, path: Option<PathBuf>) {
        self.replace(project, path);
        self.dirty = true;
    }
    pub fn mark_saved(&mut self, path: PathBuf) {
        self.path = Some(path);
        self.dirty = false;
    }
    pub fn undo(&mut self) -> bool {
        if let Some(previous) = self.undo.pop() {
            self.redo.push(self.project.clone());
            self.project = previous;
            self.dirty = true;
            true
        } else {
            false
        }
    }
    pub fn redo(&mut self) -> bool {
        if let Some(next) = self.redo.pop() {
            self.undo.push(self.project.clone());
            self.project = next;
            self.dirty = true;
            true
        } else {
            false
        }
    }
    pub fn apply(&mut self, command: EditorCommand) -> Result<(), String> {
        if let EditorCommand::UpdateView {
            zoom,
            pan,
            grid_visible,
        } = &command
        {
            if !zoom.is_finite() || !pan.x.is_finite() || !pan.y.is_finite() {
                return Err("Canvas view must contain finite coordinates".into());
            }
            self.project.ui_view_state.zoom = zoom.clamp(0.2, 4.0);
            self.project.ui_view_state.pan = *pan;
            self.project.ui_view_state.grid_visible = *grid_visible;
            self.project.updated_at = Utc::now();
            self.dirty = true;
            return Ok(());
        }
        let before = self.project.clone();
        match command {
            EditorCommand::AddComponent { kind, position } => {
                let (prefix, value) = match kind {
                    ComponentKind::Resistor => ("R", "1k"),
                    ComponentKind::Capacitor => ("C", "1u"),
                    ComponentKind::Inductor => ("L", "1m"),
                    ComponentKind::VoltageSource => ("V", "DC 5"),
                    ComponentKind::CurrentSource => ("I", "DC 1m"),
                    ComponentKind::Diode
                    | ComponentKind::BipolarTransistor
                    | ComponentKind::Mosfet
                    | ComponentKind::Subcircuit => {
                        return Err("Modeled devices must be added from an imported library".into())
                    }
                    ComponentKind::Ground => ("", ""),
                    ComponentKind::NetLabel => ("", "net"),
                    ComponentKind::Device => {
                        return Err(
                            "Device-pack components must be added from the device library".into(),
                        )
                    }
                };
                let mut number = 1;
                while !prefix.is_empty()
                    && self.project.sheets[0].components.iter().any(|c| {
                        c.spice_ref
                            .eq_ignore_ascii_case(&format!("{prefix}{number}"))
                    })
                {
                    number += 1;
                }
                let reference = if prefix.is_empty() {
                    String::new()
                } else {
                    format!("{prefix}{number}")
                };
                self.project.sheets[0]
                    .components
                    .push(component(kind, position.x, position.y, &reference, value));
            }
            EditorCommand::AddModelComponent {
                library_id,
                model_name,
                position,
            } => {
                let definition = self
                    .project
                    .spice_libraries
                    .iter()
                    .find(|library| library.id == library_id)
                    .and_then(|library| {
                        library
                            .models
                            .iter()
                            .find(|model| model.name.eq_ignore_ascii_case(&model_name))
                    })
                    .cloned()
                    .ok_or_else(|| format!("SPICE model '{model_name}' is unavailable"))?;
                let prefix = match definition.kind {
                    crate::domain::SpiceModelKind::Diode => "D",
                    crate::domain::SpiceModelKind::Bipolar => "Q",
                    crate::domain::SpiceModelKind::Mosfet => "M",
                    crate::domain::SpiceModelKind::Subcircuit => "X",
                };
                let mut number = 1;
                while self.project.sheets[0].components.iter().any(|component| {
                    component
                        .spice_ref
                        .eq_ignore_ascii_case(&format!("{prefix}{number}"))
                }) {
                    number += 1;
                }
                self.project.sheets[0].components.push(modeled_component(
                    &definition,
                    library_id,
                    position,
                    &format!("{prefix}{number}"),
                ));
            }
            EditorCommand::AddDeviceComponent {
                pack_sha256,
                device_id,
                variant_id,
                unit_id,
                logical_instance_id,
                position,
            } => {
                let component = crate::device_instance::place_unit(
                    &mut self.project,
                    &pack_sha256,
                    &device_id,
                    variant_id.as_deref(),
                    unit_id.as_deref(),
                    logical_instance_id,
                    position,
                )?;
                self.project.sheets[0].components.push(component);
            }
            EditorCommand::MoveComponent { id, position } => {
                let sheet = &mut self.project.sheets[0];
                let component = sheet
                    .components
                    .iter_mut()
                    .find(|component| component.id == id)
                    .ok_or_else(|| format!("Component {id} no longer exists"))?;
                let old_position = component.position;
                let attached_pins = if component.kind == ComponentKind::NetLabel {
                    vec![]
                } else {
                    component
                        .pins
                        .iter()
                        .map(|pin| absolute_pin(component.position, component.rotation, pin.offset))
                        .collect()
                };
                component.position = position;
                let delta = Point {
                    x: position.x - old_position.x,
                    y: position.y - old_position.y,
                };
                for wire in &mut sheet.wires {
                    wire.points = move_wire_with_component(&wire.points, &attached_pins, delta);
                }
            }
            EditorCommand::MoveSelection {
                component_ids,
                wire_ids,
                delta,
            } => {
                if !delta.x.is_finite() || !delta.y.is_finite() {
                    return Err("Movement delta must be finite".into());
                }
                let sheet = &mut self.project.sheets[0];
                let component_ids: HashSet<_> = component_ids.into_iter().collect();
                let wire_ids: HashSet<_> = wire_ids.into_iter().collect();
                let attached_pins: Vec<_> = sheet
                    .components
                    .iter()
                    .filter(|component| {
                        component_ids.contains(&component.id)
                            && component.kind != ComponentKind::NetLabel
                    })
                    .flat_map(|component| {
                        component.pins.iter().map(|pin| {
                            absolute_pin(component.position, component.rotation, pin.offset)
                        })
                    })
                    .collect();
                for component in &mut sheet.components {
                    if component_ids.contains(&component.id) {
                        component.position.x += delta.x;
                        component.position.y += delta.y;
                    }
                }
                for wire in &mut sheet.wires {
                    if wire_ids.contains(&wire.id) {
                        for point in &mut wire.points {
                            point.x += delta.x;
                            point.y += delta.y;
                        }
                        continue;
                    }
                    let start = wire.points[0];
                    let end = wire.points[wire.points.len() - 1];
                    if attached_pins.iter().any(|pin| same_point(*pin, start)) {
                        wire.points = move_wire_endpoint(
                            &wire.points,
                            true,
                            Point {
                                x: start.x + delta.x,
                                y: start.y + delta.y,
                            },
                        );
                    }
                    if attached_pins.iter().any(|pin| same_point(*pin, end)) {
                        wire.points = move_wire_endpoint(
                            &wire.points,
                            false,
                            Point {
                                x: end.x + delta.x,
                                y: end.y + delta.y,
                            },
                        );
                    }
                }
            }
            EditorCommand::UpdateComponent {
                id,
                display_name,
                spice_ref,
                value,
            } => {
                if !crate::device_instance::update_identity(
                    &mut self.project,
                    id,
                    &display_name,
                    &spice_ref,
                )? {
                    let target = self.component_mut(id)?;
                    target.display_name = display_name;
                    target.spice_ref = spice_ref;
                }
                let target = self.component_mut(id)?;
                target.parameters.insert("value".into(), value);
            }
            EditorCommand::RotateComponent { id } => {
                let target = self.component_mut(id)?;
                target.rotation = (target.rotation + 90) % 360;
            }
            EditorCommand::SetPinNoConnect {
                component_id,
                pin_id,
                no_connect,
            } => {
                let component = self.component_mut(component_id)?;
                let pin = component
                    .pins
                    .iter_mut()
                    .find(|pin| pin.id == pin_id)
                    .ok_or_else(|| format!("Pin '{pin_id}' no longer exists"))?;
                pin.no_connect = no_connect;
            }
            EditorCommand::DeleteSelection {
                component_ids,
                wire_ids,
            } => {
                let sheet = &mut self.project.sheets[0];
                sheet.components.retain(|c| !component_ids.contains(&c.id));
                sheet.wires.retain(|w| !wire_ids.contains(&w.id));
                crate::device_instance::remove_orphans(&mut self.project);
            }
            EditorCommand::InsertSelection {
                components,
                wires,
                device_instances,
                board_configurations,
            } => {
                let sheet = &mut self.project.sheets[0];
                let mut ids: HashSet<_> = sheet
                    .components
                    .iter()
                    .map(|component| component.id)
                    .chain(sheet.wires.iter().map(|wire| wire.id))
                    .collect();
                let mut references: std::collections::HashMap<_, _> = sheet
                    .components
                    .iter()
                    .filter(|component| !component.spice_ref.is_empty())
                    .map(|component| {
                        (
                            component.spice_ref.to_ascii_lowercase(),
                            component
                                .device
                                .as_ref()
                                .and_then(|binding| binding.logical_instance_id),
                        )
                    })
                    .collect();
                let existing_instances: HashSet<_> = self
                    .project
                    .device_instances
                    .iter()
                    .map(|instance| instance.id)
                    .collect();
                let mut incoming_instances = HashSet::new();
                for instance in &device_instances {
                    if existing_instances.contains(&instance.id)
                        || !incoming_instances.insert(instance.id)
                    {
                        return Err(format!(
                            "Logical device instance {} already exists",
                            instance.id
                        ));
                    }
                }
                for component in &components {
                    if !component.position.x.is_finite() || !component.position.y.is_finite() {
                        return Err("Component coordinates must be finite".into());
                    }
                    if !ids.insert(component.id) {
                        return Err(format!("Item {} already exists", component.id));
                    }
                    if !component.spice_ref.is_empty() {
                        let key = component.spice_ref.to_ascii_lowercase();
                        let owner = component
                            .device
                            .as_ref()
                            .and_then(|binding| binding.logical_instance_id);
                        if references
                            .get(&key)
                            .is_some_and(|existing| *existing != owner)
                        {
                            return Err(format!(
                                "Component reference '{}' already exists",
                                component.spice_ref
                            ));
                        }
                        references.insert(key, owner);
                    }
                }
                for wire in &wires {
                    validate_wire_points(&wire.points)?;
                    if !ids.insert(wire.id) {
                        return Err(format!("Item {} already exists", wire.id));
                    }
                }
                let mut candidate = self.project.clone();
                candidate.device_instances.extend(device_instances);
                candidate.board_configurations.extend(board_configurations);
                candidate.sheets[0].components.extend(components);
                candidate.sheets[0].wires.extend(wires);
                crate::device_instance::validate(&candidate)?;
                crate::board_config::validate_project(&candidate)?;
                self.project = candidate;
            }
            EditorCommand::AddWire { points } => {
                validate_wire_points(&points)?;
                self.project.sheets[0].wires.push(Wire {
                    id: Uuid::new_v4(),
                    points,
                });
            }
            EditorCommand::UpdateWire { id, points } => {
                validate_wire_points(&points)?;
                let target = self.project.sheets[0]
                    .wires
                    .iter_mut()
                    .find(|wire| wire.id == id)
                    .ok_or_else(|| format!("Wire {id} no longer exists"))?;
                target.points = points;
            }
            EditorCommand::DeleteWire { id } => self.project.sheets[0].wires.retain(|w| w.id != id),
            EditorCommand::UpdateView {
                zoom: _,
                pan: _,
                grid_visible: _,
            } => unreachable!("view commands return before the undoable edit path"),
            EditorCommand::UpdateSimulation { profile } => {
                if let Some(target) = self
                    .project
                    .simulation_profiles
                    .iter_mut()
                    .find(|p| p.id == profile.id)
                {
                    *target = profile
                } else {
                    self.project.simulation_profiles.push(profile)
                }
            }
            EditorCommand::AddSimulationProfile { profile } => {
                if self
                    .project
                    .simulation_profiles
                    .iter()
                    .any(|existing| existing.id == profile.id)
                {
                    return Err(format!("Simulation profile {} already exists", profile.id));
                }
                self.project.active_simulation_profile = Some(profile.id);
                self.project.simulation_profiles.push(profile);
            }
            EditorCommand::DeleteSimulationProfile { id } => {
                if self.project.simulation_profiles.len() <= 1 {
                    return Err("A project needs at least one simulation profile".into());
                }
                self.project
                    .simulation_profiles
                    .retain(|profile| profile.id != id);
                if self.project.active_simulation_profile == Some(id) {
                    self.project.active_simulation_profile = self
                        .project
                        .simulation_profiles
                        .first()
                        .map(|profile| profile.id);
                }
            }
            EditorCommand::SelectSimulationProfile { id } => {
                if !self
                    .project
                    .simulation_profiles
                    .iter()
                    .any(|profile| profile.id == id)
                {
                    return Err(format!("Simulation profile {id} no longer exists"));
                }
                self.project.active_simulation_profile = Some(id);
            }
            EditorCommand::RemoveBoardConfiguration { id } => {
                if !self
                    .project
                    .board_configurations
                    .iter()
                    .any(|configuration| configuration.id == id)
                {
                    return Err(format!("Board configuration {id} no longer exists"));
                }
                self.project
                    .board_configurations
                    .retain(|configuration| configuration.id != id);
            }
            EditorCommand::RemoveDevicePack { pack_sha256 } => {
                if self
                    .project
                    .device_instances
                    .iter()
                    .any(|instance| instance.pack_sha256 == pack_sha256)
                {
                    return Err(
                        "Device pack is still used by logical device instances; remove those devices first"
                            .into(),
                    );
                }
                let previous_len = self.project.device_packs.len();
                self.project
                    .device_packs
                    .retain(|pack| pack.sha256 != pack_sha256);
                if self.project.device_packs.len() == previous_len {
                    return Err("Device pack no longer exists".into());
                }
            }
        }
        self.project.updated_at = Utc::now();
        self.undo.push(before);
        if self.undo.len() > 100 {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.dirty = true;
        Ok(())
    }
    fn component_mut(&mut self, id: Uuid) -> Result<&mut crate::domain::Component, String> {
        self.project.sheets[0]
            .components
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("Component {id} no longer exists"))
    }
    pub fn active_analysis(&self) -> Option<Analysis> {
        let id = self.project.active_simulation_profile?;
        self.project
            .simulation_profiles
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.analysis.clone())
    }

    pub fn add_spice_library(&mut self, library: SpiceLibrary) -> Result<(), String> {
        crate::models::validate_library(&library).map_err(|error| error.to_string())?;
        let before = self.project.clone();
        if self
            .project
            .spice_libraries
            .iter()
            .any(|existing| existing.sha256 == library.sha256)
        {
            return Ok(());
        } else {
            if library.models.iter().any(|model| {
                self.project
                    .spice_libraries
                    .iter()
                    .flat_map(|source| &source.models)
                    .any(|existing| existing.name.eq_ignore_ascii_case(&model.name))
            }) {
                return Err("A model with the same name is already imported. Use a separate project for a different version.".into());
            }
            self.project.spice_libraries.push(library);
            self.project.updated_at = Utc::now();
            self.undo.push(before);
            if self.undo.len() > 100 {
                self.undo.remove(0);
            }
            self.redo.clear();
            self.dirty = true;
        }
        Ok(())
    }

    pub fn add_device_pack(
        &mut self,
        pack: EmbeddedDevicePack,
        libraries: Vec<SpiceLibrary>,
    ) -> Result<(), String> {
        crate::device_pack::validate(&pack.pack).map_err(|error| error.to_string())?;
        if self
            .project
            .device_packs
            .iter()
            .any(|existing| existing.sha256 == pack.sha256)
        {
            return Ok(());
        }
        if let Some(existing) = self.project.device_packs.iter().find(|existing| {
            existing.pack.manifest.id == pack.pack.manifest.id
                && existing.pack.manifest.version == pack.pack.manifest.version
        }) {
            return Err(format!(
                "Device pack {} version {} is already embedded with a different content hash ({})",
                pack.pack.manifest.id, pack.pack.manifest.version, existing.sha256
            ));
        }
        let before = self.project.clone();
        for library in libraries {
            if !self
                .project
                .spice_libraries
                .iter()
                .any(|existing| existing.sha256 == library.sha256)
            {
                crate::models::validate_library(&library).map_err(|error| error.to_string())?;
                self.project.spice_libraries.push(library);
            }
        }
        self.project.device_packs.push(pack);
        self.project.updated_at = Utc::now();
        self.undo.push(before);
        if self.undo.len() > 100 {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.dirty = true;
        Ok(())
    }

    pub fn upsert_board_configuration(
        &mut self,
        mut configuration: crate::board_config::BoardConfiguration,
    ) -> Result<(), String> {
        crate::board_config::validate_project_candidate(&self.project, &configuration)?;
        let before = self.project.clone();
        if let Some(existing) = self
            .project
            .board_configurations
            .iter_mut()
            .find(|existing| existing.logical_instance_id == configuration.logical_instance_id)
        {
            configuration.id = existing.id;
            *existing = configuration;
        } else {
            self.project.board_configurations.push(configuration);
        }
        self.project.updated_at = Utc::now();
        self.undo.push(before);
        if self.undo.len() > 100 {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.dirty = true;
        Ok(())
    }
}

fn validate_wire_points(points: &[Point]) -> Result<(), String> {
    if points.len() < 2 {
        return Err("A wire needs at least two points".into());
    }
    if points
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return Err("Wire coordinates must be finite".into());
    }
    if points.windows(2).any(|segment| {
        (segment[0].x - segment[1].x).abs() > 0.001 && (segment[0].y - segment[1].y).abs() > 0.001
    }) {
        return Err("Wire segments must be horizontal or vertical".into());
    }
    Ok(())
}

fn same_point(a: Point, b: Point) -> bool {
    (a.x - b.x).abs() < 0.001 && (a.y - b.y).abs() < 0.001
}

fn absolute_pin(position: Point, rotation: i32, offset: Point) -> Point {
    let rotated = match rotation.rem_euclid(360) {
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
        x: position.x + rotated.x,
        y: position.y + rotated.y,
    }
}

fn simplify_wire(points: Vec<Point>) -> Vec<Point> {
    let mut simplified: Vec<Point> = vec![];
    for point in points {
        if simplified
            .last()
            .is_some_and(|last| same_point(*last, point))
        {
            continue;
        }
        while simplified.len() >= 2 {
            let a = simplified[simplified.len() - 2];
            let b = simplified[simplified.len() - 1];
            let vertical = (a.x - b.x).abs() < 0.001 && (b.x - point.x).abs() < 0.001;
            let horizontal = (a.y - b.y).abs() < 0.001 && (b.y - point.y).abs() < 0.001;
            if !vertical && !horizontal {
                break;
            }
            simplified.pop();
        }
        simplified.push(point);
    }
    simplified
}

fn move_wire_endpoint(points: &[Point], start: bool, target: Point) -> Vec<Point> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let terminal = if start {
        points[0]
    } else {
        points[points.len() - 1]
    };
    let neighbor = if start {
        points[1]
    } else {
        points[points.len() - 2]
    };
    let horizontal = (terminal.y - neighbor.y).abs() < 0.001;
    let corner = if horizontal {
        Point {
            x: neighbor.x,
            y: target.y,
        }
    } else {
        Point {
            x: target.x,
            y: neighbor.y,
        }
    };
    let mut moved = if start {
        vec![target, corner, neighbor]
    } else {
        points[..points.len() - 2].to_vec()
    };
    if start {
        moved.extend_from_slice(&points[2..]);
    } else {
        moved.extend([neighbor, corner, target]);
    }
    let simplified = simplify_wire(moved);
    if simplified.len() >= 2 {
        simplified
    } else {
        points.to_vec()
    }
}

fn move_wire_with_component(points: &[Point], pins: &[Point], delta: Point) -> Vec<Point> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let start = points[0];
    let end = points[points.len() - 1];
    let mut moved = points.to_vec();
    if pins.iter().any(|pin| same_point(*pin, start)) {
        moved = move_wire_endpoint(
            &moved,
            true,
            Point {
                x: start.x + delta.x,
                y: start.y + delta.y,
            },
        );
    }
    if pins.iter().any(|pin| same_point(*pin, end)) {
        moved = move_wire_endpoint(
            &moved,
            false,
            Point {
                x: end.x + delta.x,
                y: end.y + delta.y,
            },
        );
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn semantic_commands_are_undoable() {
        let mut w = Workspace::new(Project::blank("x"));
        w.apply(EditorCommand::AddComponent {
            kind: ComponentKind::Resistor,
            position: Point { x: 1., y: 2. },
        })
        .unwrap();
        assert_eq!(w.project.sheets[0].components.len(), 1);
        assert!(w.undo());
        assert!(w.project.sheets[0].components.is_empty());
        assert!(w.redo());
        assert_eq!(w.project.sheets[0].components.len(), 1);
    }

    #[test]
    fn importing_and_placing_a_device_pack_is_undoable_and_conflict_safe() {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut workspace = Workspace::new(Project::blank("packs"));
        workspace.add_device_pack(pack.clone(), vec![]).unwrap();
        workspace
            .apply(EditorCommand::AddDeviceComponent {
                pack_sha256: pack.sha256.clone(),
                device_id: "stmcu24".into(),
                variant_id: Some("industrial".into()),
                unit_id: Some("core".into()),
                position: Point { x: 200.0, y: 200.0 },
                logical_instance_id: None,
            })
            .unwrap();
        assert_eq!(
            workspace.project.sheets[0].components[0].kind,
            ComponentKind::Device
        );
        assert_eq!(workspace.project.device_instances.len(), 1);
        assert!(workspace.undo());
        assert!(workspace.project.sheets[0].components.is_empty());
        assert!(workspace.project.device_instances.is_empty());

        let mut conflict = pack;
        conflict.pack.manifest.name.push_str(" changed");
        conflict.sha256 = crate::device_pack::content_hash(&conflict.pack);
        assert!(workspace.add_device_pack(conflict, vec![]).is_err());

        let mut next_version = workspace.project.device_packs[0].clone();
        next_version.pack.manifest.version = "1.1.0".into();
        next_version.sha256 = crate::device_pack::content_hash(&next_version.pack);
        workspace.add_device_pack(next_version, vec![]).unwrap();
        assert_eq!(workspace.project.device_packs.len(), 2);
    }

    #[test]
    fn device_pack_removal_is_safe_and_undoable() {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let hash = pack.sha256.clone();
        let mut workspace = Workspace::new(Project::blank("packs"));
        workspace.add_device_pack(pack, vec![]).unwrap();
        workspace
            .apply(EditorCommand::RemoveDevicePack {
                pack_sha256: hash.clone(),
            })
            .unwrap();
        assert!(workspace.project.device_packs.is_empty());
        assert!(workspace.undo());
        assert_eq!(workspace.project.device_packs.len(), 1);

        workspace
            .apply(EditorCommand::AddDeviceComponent {
                pack_sha256: hash.clone(),
                device_id: "stmcu24".into(),
                variant_id: None,
                unit_id: Some("core".into()),
                logical_instance_id: None,
                position: Point { x: 100.0, y: 100.0 },
            })
            .unwrap();
        assert!(workspace
            .apply(EditorCommand::RemoveDevicePack { pack_sha256: hash })
            .is_err());
        assert_eq!(workspace.project.device_packs.len(), 1);
    }

    #[test]
    fn wire_edits_keep_the_id_and_are_undoable() {
        let mut w = Workspace::new(Project::blank("x"));
        w.apply(EditorCommand::AddWire {
            points: vec![Point { x: 0., y: 0. }, Point { x: 40., y: 0. }],
        })
        .unwrap();
        let id = w.project.sheets[0].wires[0].id;
        w.apply(EditorCommand::UpdateWire {
            id,
            points: vec![
                Point { x: 0., y: 0. },
                Point { x: 0., y: 20. },
                Point { x: 40., y: 20. },
                Point { x: 40., y: 0. },
            ],
        })
        .unwrap();
        assert_eq!(w.project.sheets[0].wires[0].id, id);
        assert_eq!(w.project.sheets[0].wires[0].points.len(), 4);
        assert!(w.undo());
        assert_eq!(w.project.sheets[0].wires[0].points.len(), 2);
    }

    #[test]
    fn moving_a_component_rubber_bands_attached_wires_and_undoes_together() {
        let mut w = Workspace::new(Project::blank("x"));
        w.apply(EditorCommand::AddComponent {
            kind: ComponentKind::Resistor,
            position: Point { x: 100., y: 100. },
        })
        .unwrap();
        let component_id = w.project.sheets[0].components[0].id;
        w.apply(EditorCommand::AddWire {
            points: vec![Point { x: 60., y: 100. }, Point { x: 0., y: 100. }],
        })
        .unwrap();
        w.apply(EditorCommand::MoveComponent {
            id: component_id,
            position: Point { x: 120., y: 140. },
        })
        .unwrap();
        assert_eq!(
            w.project.sheets[0].wires[0].points,
            vec![
                Point { x: 80., y: 140. },
                Point { x: 0., y: 140. },
                Point { x: 0., y: 100. },
            ]
        );
        assert!(w.undo());
        assert_eq!(
            w.project.sheets[0].components[0].position,
            Point { x: 100., y: 100. }
        );
        assert_eq!(
            w.project.sheets[0].wires[0].points,
            vec![Point { x: 60., y: 100. }, Point { x: 0., y: 100. }]
        );
    }

    #[test]
    fn moving_a_selection_translates_selected_wires_and_stretches_unselected_wires() {
        let mut w = Workspace::new(Project::blank("x"));
        w.apply(EditorCommand::AddComponent {
            kind: ComponentKind::Resistor,
            position: Point { x: 100., y: 100. },
        })
        .unwrap();
        let component_id = w.project.sheets[0].components[0].id;
        w.apply(EditorCommand::AddWire {
            points: vec![Point { x: 60., y: 100. }, Point { x: 0., y: 100. }],
        })
        .unwrap();
        w.apply(EditorCommand::MoveSelection {
            component_ids: vec![component_id],
            wire_ids: vec![],
            delta: Point { x: 1., y: 0. },
        })
        .unwrap();
        assert_eq!(w.project.sheets[0].components[0].position.x, 101.);
        assert_eq!(w.project.sheets[0].wires[0].points[0].x, 61.);
    }

    #[test]
    fn inserts_a_copied_selection_as_one_undoable_edit() {
        let mut w = Workspace::new(Project::blank("x"));
        let copied = component(ComponentKind::Resistor, 120., 120., "R2", "1k");
        let copied_id = copied.id;
        w.apply(EditorCommand::InsertSelection {
            components: vec![copied],
            wires: vec![Wire {
                id: Uuid::new_v4(),
                points: vec![Point { x: 80., y: 120. }, Point { x: 20., y: 120. }],
            }],
            device_instances: vec![],
            board_configurations: vec![],
        })
        .unwrap();
        assert_eq!(w.project.sheets[0].components[0].id, copied_id);
        assert_eq!(w.project.sheets[0].wires.len(), 1);
        assert!(w.undo());
        assert!(w.project.sheets[0].components.is_empty());
        assert!(w.project.sheets[0].wires.is_empty());
    }

    #[test]
    fn adds_selects_and_deletes_simulation_profiles() {
        let mut w = Workspace::new(Project::blank("x"));
        let original = w.project.active_simulation_profile.unwrap();
        let profile = SimulationProfile {
            id: Uuid::new_v4(),
            name: "AC response".into(),
            analysis: Analysis::AcSweep {
                variation: "dec".into(),
                points: 100,
                start: "10".into(),
                stop: "1Meg".into(),
            },
            signals: vec![],
        };
        let profile_id = profile.id;
        w.apply(EditorCommand::AddSimulationProfile { profile })
            .unwrap();
        assert_eq!(w.project.active_simulation_profile, Some(profile_id));
        assert_eq!(w.project.simulation_profiles.len(), 2);
        w.apply(EditorCommand::SelectSimulationProfile { id: original })
            .unwrap();
        w.apply(EditorCommand::DeleteSimulationProfile { id: profile_id })
            .unwrap();
        assert_eq!(w.project.simulation_profiles.len(), 1);
        assert_eq!(w.project.active_simulation_profile, Some(original));
    }

    #[test]
    fn viewport_updates_do_not_clone_into_undo_history() {
        let mut w = Workspace::new(Project::blank("large"));
        w.apply(EditorCommand::UpdateView {
            zoom: 1.5,
            pan: Point { x: 40.0, y: -20.0 },
            grid_visible: false,
        })
        .unwrap();
        let snapshot = w.snapshot();
        assert!(snapshot.dirty);
        assert!(!snapshot.can_undo);
        assert_eq!(snapshot.project.ui_view_state.zoom, 1.5);
    }
}
