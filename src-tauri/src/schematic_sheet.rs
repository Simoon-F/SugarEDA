//! Schematic-sheet lifecycle and active-sheet resolution.

use crate::domain::{Project, SchematicSheet};
use std::collections::HashSet;
use uuid::Uuid;

const MAX_SHEETS: usize = 128;
const MAX_SHEET_NAME: usize = 96;

pub fn active(project: &Project) -> Result<&SchematicSheet, String> {
    project
        .sheets
        .iter()
        .find(|sheet| sheet.id == project.ui_view_state.active_sheet_id)
        .ok_or_else(|| "Active schematic sheet is unavailable".to_owned())
}

pub fn active_mut(project: &mut Project) -> Result<&mut SchematicSheet, String> {
    let id = project.ui_view_state.active_sheet_id;
    project
        .sheets
        .iter_mut()
        .find(|sheet| sheet.id == id)
        .ok_or_else(|| "Active schematic sheet is unavailable".to_owned())
}

pub fn select(project: &mut Project, id: Uuid) -> Result<(), String> {
    if !project.sheets.iter().any(|sheet| sheet.id == id) {
        return Err(format!("Schematic sheet {id} no longer exists"));
    }
    project.ui_view_state.active_sheet_id = id;
    Ok(())
}

pub fn add(project: &mut Project, name: String) -> Result<Uuid, String> {
    if project.sheets.len() >= MAX_SHEETS {
        return Err(format!(
            "Projects are limited to {MAX_SHEETS} schematic sheets"
        ));
    }
    validate_name(project, None, &name)?;
    let id = Uuid::new_v4();
    project.sheets.push(SchematicSheet {
        id,
        name,
        components: Vec::new(),
        wires: Vec::new(),
        net_labels: Vec::new(),
    });
    project.ui_view_state.active_sheet_id = id;
    Ok(id)
}

pub fn rename(project: &mut Project, id: Uuid, name: String) -> Result<(), String> {
    validate_name(project, Some(id), &name)?;
    let sheet = project
        .sheets
        .iter_mut()
        .find(|sheet| sheet.id == id)
        .ok_or_else(|| format!("Schematic sheet {id} no longer exists"))?;
    sheet.name = name;
    Ok(())
}

pub fn remove(project: &mut Project, id: Uuid) -> Result<(), String> {
    if project.sheets.len() <= 1 {
        return Err("A project must keep at least one schematic sheet".into());
    }
    let index = project
        .sheets
        .iter()
        .position(|sheet| sheet.id == id)
        .ok_or_else(|| format!("Schematic sheet {id} no longer exists"))?;
    project.sheets.remove(index);
    if project.ui_view_state.active_sheet_id == id {
        project.ui_view_state.active_sheet_id =
            project.sheets[index.min(project.sheets.len() - 1)].id;
    }
    crate::device_instance::remove_orphans(project);
    Ok(())
}

pub fn validate(project: &Project) -> Result<(), String> {
    if project.sheets.is_empty() || project.sheets.len() > MAX_SHEETS {
        return Err(format!(
            "A project must contain 1 to {MAX_SHEETS} schematic sheets"
        ));
    }
    let mut sheet_ids = HashSet::new();
    let mut names = HashSet::new();
    let mut item_ids = HashSet::new();
    for sheet in &project.sheets {
        if !sheet_ids.insert(sheet.id) {
            return Err(format!("Duplicate schematic sheet id {}", sheet.id));
        }
        if sheet.name.trim() != sheet.name
            || sheet.name.is_empty()
            || sheet.name.len() > MAX_SHEET_NAME
            || sheet.name.chars().any(char::is_control)
        {
            return Err(format!("Invalid schematic sheet name '{}'", sheet.name));
        }
        if !names.insert(sheet.name.to_lowercase()) {
            return Err(format!("Duplicate schematic sheet name '{}'", sheet.name));
        }
        for id in sheet
            .components
            .iter()
            .map(|component| component.id)
            .chain(sheet.wires.iter().map(|wire| wire.id))
        {
            if !item_ids.insert(id) {
                return Err(format!("Duplicate schematic item id {id}"));
            }
        }
    }
    Ok(())
}

fn validate_name(project: &Project, current_id: Option<Uuid>, name: &str) -> Result<(), String> {
    if name.trim() != name
        || name.is_empty()
        || name.len() > MAX_SHEET_NAME
        || name.chars().any(char::is_control)
    {
        return Err(format!(
            "Schematic sheet name must contain 1 to {MAX_SHEET_NAME} safe characters"
        ));
    }
    if project
        .sheets
        .iter()
        .any(|sheet| Some(sheet.id) != current_id && sheet.name.eq_ignore_ascii_case(name))
    {
        return Err(format!("Schematic sheet name '{name}' is already used"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sheet_lifecycle_tracks_active_id_and_keeps_one_sheet() {
        let mut project = Project::blank("multi-sheet");
        let first = project.sheets[0].id;
        let power = add(&mut project, "Power".into()).unwrap();
        assert_eq!(active(&project).unwrap().id, power);
        rename(&mut project, power, "Power Rails".into()).unwrap();
        select(&mut project, first).unwrap();
        remove(&mut project, power).unwrap();
        assert_eq!(project.sheets.len(), 1);
        assert!(remove(&mut project, first).is_err());
    }

    #[test]
    fn rejects_duplicate_and_unsafe_sheet_names() {
        let mut project = Project::blank("multi-sheet");
        assert!(add(&mut project, "Main".into()).is_err());
        assert!(add(&mut project, " bad ".into()).is_err());
        assert!(add(&mut project, "bad\nname".into()).is_err());
    }

    #[test]
    fn validation_rejects_duplicate_sheet_identity() {
        let mut project = Project::blank("multi-sheet");
        let duplicate = project.sheets[0].clone();
        project.sheets.push(duplicate);
        assert!(validate(&project).is_err());
    }
}
