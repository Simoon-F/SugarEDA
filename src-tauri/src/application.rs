use crate::domain::{
    component, modeled_component, Analysis, ComponentKind, Point, Project, SimulationProfile,
    SpiceLibrary, Wire,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    MoveComponent {
        id: Uuid,
        position: Point,
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
    DeleteSelection {
        component_ids: Vec<Uuid>,
        wire_ids: Vec<Uuid>,
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
    pub fn replace(&mut self, project: Project, path: Option<PathBuf>) {
        self.project = project;
        self.path = path;
        self.dirty = false;
        self.undo.clear();
        self.redo.clear();
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
            EditorCommand::UpdateComponent {
                id,
                display_name,
                spice_ref,
                value,
            } => {
                let target = self.component_mut(id)?;
                target.display_name = display_name;
                target.spice_ref = spice_ref;
                target.parameters.insert("value".into(), value);
            }
            EditorCommand::RotateComponent { id } => {
                let target = self.component_mut(id)?;
                target.rotation = (target.rotation + 90) % 360;
            }
            EditorCommand::DeleteSelection {
                component_ids,
                wire_ids,
            } => {
                let sheet = &mut self.project.sheets[0];
                sheet.components.retain(|c| !component_ids.contains(&c.id));
                sheet.wires.retain(|w| !wire_ids.contains(&w.id));
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
                zoom,
                pan,
                grid_visible,
            } => {
                self.project.ui_view_state.zoom = zoom.clamp(0.2, 4.0);
                self.project.ui_view_state.pan = pan;
                self.project.ui_view_state.grid_visible = grid_visible;
            }
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
}
