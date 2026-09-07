use crate::domain::{Project, SCHEMA_VERSION};
use crate::models::ModelImportError;
use std::{fs, io::Write, path::Path};
use thiserror::Error;

const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("project path must use the .sugeda extension")]
    Extension,
    #[error("project file is larger than 64 MiB")]
    TooLarge,
    #[error("cannot read project: {0}")]
    Read(#[from] std::io::Error),
    #[error("project JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported schema version {0}; this app supports version {SCHEMA_VERSION}")]
    Schema(u32),
    #[error("project must contain at least one schematic sheet")]
    NoSheets,
    #[error("project contains an invalid component coordinate")]
    InvalidComponentCoordinate,
    #[error("project contains a wire with fewer than two points")]
    InvalidWire,
    #[error("project contains a non-finite or non-orthogonal wire segment")]
    InvalidWireGeometry,
    #[error("project contains an invalid canvas view")]
    InvalidView,
    #[error("project active sheet does not reference an existing schematic sheet")]
    InvalidActiveSheet,
    #[error("project schematic sheets are invalid: {0}")]
    InvalidSheet(String),
    #[error("embedded SPICE model is invalid: {0}")]
    Model(#[from] ModelImportError),
    #[error("embedded device pack is invalid: {0}")]
    DevicePack(String),
    #[error("device component binding is missing or inconsistent")]
    DeviceBinding,
    #[error("logical device instance is invalid: {0}")]
    DeviceInstance(String),
    #[error("board configuration is invalid: {0}")]
    BoardConfiguration(String),
}

pub fn load(path: &Path) -> Result<Project, ProjectError> {
    validate_extension(path)?;
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let bytes = fs::read(path)?;
    let mut project: Project = serde_json::from_slice(&bytes)?;
    if matches!(project.schema_version, 1..=3) {
        crate::device_instance::migrate_legacy_components(&mut project);
        project.schema_version = SCHEMA_VERSION;
    }
    validate(&project)?;
    Ok(project)
}

pub fn save(path: &Path, project: &Project) -> Result<(), ProjectError> {
    validate_extension(path)?;
    validate(project)?;
    let parent = path.parent().ok_or(ProjectError::Extension)?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec_pretty(project)?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|error| ProjectError::Read(error.error))?;
    Ok(())
}

fn validate_extension(path: &Path) -> Result<(), ProjectError> {
    match path.extension().and_then(|v| v.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("sugeda") => Ok(()),
        _ => Err(ProjectError::Extension),
    }
}

pub fn validate(project: &Project) -> Result<(), ProjectError> {
    if project.schema_version != SCHEMA_VERSION {
        return Err(ProjectError::Schema(project.schema_version));
    }
    if project.sheets.is_empty() {
        return Err(ProjectError::NoSheets);
    }
    if !project
        .sheets
        .iter()
        .any(|sheet| sheet.id == project.ui_view_state.active_sheet_id)
    {
        return Err(ProjectError::InvalidActiveSheet);
    }
    crate::schematic_sheet::validate(project).map_err(ProjectError::InvalidSheet)?;
    for sheet in &project.sheets {
        if sheet.components.iter().any(|component| {
            !component.position.x.is_finite()
                || !component.position.y.is_finite()
                || component
                    .pins
                    .iter()
                    .any(|pin| !pin.offset.x.is_finite() || !pin.offset.y.is_finite())
        }) {
            return Err(ProjectError::InvalidComponentCoordinate);
        }
        for wire in &sheet.wires {
            if wire.points.len() < 2 {
                return Err(ProjectError::InvalidWire);
            }
            if wire
                .points
                .iter()
                .any(|point| !point.x.is_finite() || !point.y.is_finite())
                || wire.points.windows(2).any(|segment| {
                    (segment[0].x - segment[1].x).abs() > 0.001
                        && (segment[0].y - segment[1].y).abs() > 0.001
                })
            {
                return Err(ProjectError::InvalidWireGeometry);
            }
        }
    }
    if !project.ui_view_state.zoom.is_finite()
        || !(0.2..=4.0).contains(&project.ui_view_state.zoom)
        || !project.ui_view_state.pan.x.is_finite()
        || !project.ui_view_state.pan.y.is_finite()
    {
        return Err(ProjectError::InvalidView);
    }
    for library in &project.spice_libraries {
        crate::models::validate_library(library)?;
    }
    let mut hashes = std::collections::BTreeSet::new();
    let mut pack_versions = std::collections::BTreeSet::new();
    for embedded in &project.device_packs {
        crate::device_pack::validate(&embedded.pack)
            .map_err(|error| ProjectError::DevicePack(error.to_string()))?;
        if embedded.sha256 != crate::device_pack::content_hash(&embedded.pack) {
            return Err(ProjectError::DevicePack(
                "device-pack content hash mismatch".into(),
            ));
        }
        if !hashes.insert(&embedded.sha256) {
            return Err(ProjectError::DevicePack(
                "duplicate device-pack content hash".into(),
            ));
        }
        if !pack_versions.insert((
            embedded.pack.manifest.id.as_str(),
            embedded.pack.manifest.version.as_str(),
        )) {
            return Err(ProjectError::DevicePack(format!(
                "duplicate device-pack identity {} version {}",
                embedded.pack.manifest.id, embedded.pack.manifest.version
            )));
        }
    }
    for component in project.sheets.iter().flat_map(|sheet| &sheet.components) {
        if component.kind == crate::domain::ComponentKind::Device {
            let Some(binding) = &component.device else {
                return Err(ProjectError::DeviceBinding);
            };
            let Some(pack) = project
                .device_packs
                .iter()
                .find(|pack| pack.sha256 == binding.pack_sha256)
            else {
                return Err(ProjectError::DeviceBinding);
            };
            if pack.pack.manifest.id != binding.pack_id
                || pack.pack.manifest.version != binding.pack_version
                || !pack
                    .pack
                    .devices
                    .iter()
                    .any(|device| device.id == binding.device_id)
            {
                return Err(ProjectError::DeviceBinding);
            }
        }
    }
    crate::device_instance::validate(project).map_err(ProjectError::DeviceInstance)?;
    crate::board_config::validate_project(project).map_err(ProjectError::BoardConfiguration)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_preserves_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("round-trip.sugeda");
        let project = crate::domain::test_rc_project();
        save(&path, &project).unwrap();
        assert_eq!(project, load(&path).unwrap());
    }

    #[test]
    fn multiple_sheets_and_active_selection_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("multi-sheet.sugeda");
        let mut project = Project::blank("multi-sheet");
        let second = crate::schematic_sheet::add(&mut project, "Power".into()).unwrap();
        crate::schematic_sheet::active_mut(&mut project)
            .unwrap()
            .components
            .push(crate::domain::component(
                crate::domain::ComponentKind::Capacitor,
                100.0,
                100.0,
                "C1",
                "1u",
            ));
        save(&path, &project).unwrap();
        let reopened = load(&path).unwrap();
        assert_eq!(reopened.sheets.len(), 2);
        assert_eq!(reopened.ui_view_state.active_sheet_id, second);
        assert_eq!(reopened.sheets[1].components[0].spice_ref, "C1");
    }

    #[test]
    fn rejects_invalid_wire_geometry_before_it_reaches_the_canvas() {
        let mut project = crate::domain::Project::blank("invalid");
        project.sheets[0].wires.push(crate::domain::Wire {
            id: uuid::Uuid::new_v4(),
            points: vec![
                crate::domain::Point { x: 0.0, y: 0.0 },
                crate::domain::Point { x: 20.0, y: 20.0 },
            ],
        });
        assert!(matches!(
            validate(&project),
            Err(ProjectError::InvalidWireGeometry)
        ));
    }

    #[test]
    fn rejects_active_sheet_ids_outside_the_project() {
        let mut project = Project::blank("invalid active sheet");
        project.ui_view_state.active_sheet_id = uuid::Uuid::new_v4();
        assert!(matches!(
            validate(&project),
            Err(ProjectError::InvalidActiveSheet)
        ));
    }

    #[test]
    fn version_two_projects_migrate_and_embedded_device_instances_round_trip() {
        let embedded = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("device round trip");
        project.device_packs.push(embedded.clone());
        let component = crate::device_instance::place_unit(
            &mut project,
            &embedded.sha256,
            "stmcu24",
            Some("industrial"),
            Some("core"),
            None,
            crate::domain::Point { x: 300.0, y: 300.0 },
        )
        .unwrap();
        project.sheets[0].components.push(component.clone());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("device.sugeda");
        save(&path, &project).unwrap();
        let reopened = load(&path).unwrap();
        assert_eq!(reopened.device_packs, project.device_packs);
        assert_eq!(reopened.sheets[0].components[0].device, component.device);
        assert_eq!(reopened.sheets[0].components[0].pins, component.pins);
        assert_eq!(reopened.device_instances, project.device_instances);

        let mut value = serde_json::to_value(Project::blank("legacy")).unwrap();
        value["schemaVersion"] = 2.into();
        value.as_object_mut().unwrap().remove("devicePacks");
        value.as_object_mut().unwrap().remove("deviceInstances");
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let migrated = load(&path).unwrap();
        assert_eq!(migrated.schema_version, SCHEMA_VERSION);
        assert!(migrated.device_packs.is_empty());

        let mut legacy_v3 = serde_json::to_value(&project).unwrap();
        legacy_v3["schemaVersion"] = 3.into();
        legacy_v3.as_object_mut().unwrap().remove("deviceInstances");
        legacy_v3["sheets"][0]["components"][0]["device"]
            .as_object_mut()
            .unwrap()
            .remove("logicalInstanceId");
        std::fs::write(&path, serde_json::to_vec(&legacy_v3).unwrap()).unwrap();
        let migrated_v3 = load(&path).unwrap();
        assert_eq!(migrated_v3.device_instances.len(), 1);
        assert_eq!(
            migrated_v3.sheets[0].components[0]
                .device
                .as_ref()
                .unwrap()
                .logical_instance_id,
            Some(migrated_v3.device_instances[0].id)
        );
    }

    #[test]
    fn schema_v4_without_board_configurations_opens_as_an_empty_collection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy-v4.sugeda");
        let mut value = serde_json::to_value(Project::blank("legacy v4")).unwrap();
        value.as_object_mut().unwrap().remove("boardConfigurations");
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let reopened = load(&path).unwrap();
        assert_eq!(reopened.schema_version, 4);
        assert!(reopened.board_configurations.is_empty());
    }

    #[test]
    fn rejects_duplicate_pack_id_and_version_even_with_distinct_hashes() {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut changed = pack.clone();
        changed.pack.manifest.name.push_str(" changed");
        changed.sha256 = crate::device_pack::content_hash(&changed.pack);
        let mut project = Project::blank("conflict");
        project.device_packs.extend([pack, changed]);
        assert!(matches!(
            validate(&project),
            Err(ProjectError::DevicePack(_))
        ));
    }
}
