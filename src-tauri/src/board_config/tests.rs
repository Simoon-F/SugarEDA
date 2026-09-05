use super::{
    build_from_draft, check_all, export_configuration, load_for_instance,
    BoardConfigurationExportFormat, BoardConfigurationSourceFormat,
};
use crate::{
    application::Workspace,
    domain::{Point, Project},
};

fn project_with_mcu() -> (Project, uuid::Uuid) {
    let pack = crate::device_pack::import_bytes(include_bytes!(
        "../../../examples/devicepacks/test-mcu.devicepack.json"
    ))
    .unwrap();
    let mut project = Project::blank("board configuration");
    let hash = pack.sha256.clone();
    project.device_packs.push(pack);
    let component = crate::device_instance::place_unit(
        &mut project,
        &hash,
        "stmcu24",
        Some("industrial"),
        Some("core"),
        None,
        Point { x: 0.0, y: 0.0 },
    )
    .unwrap();
    let instance_id = component
        .device
        .as_ref()
        .unwrap()
        .logical_instance_id
        .unwrap();
    project.sheets[0].components.push(component);
    (project, instance_id)
}

fn fixture_path(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(name);
    std::fs::write(&path, bytes).unwrap();
    (directory, path)
}

#[test]
fn persisted_configuration_round_trips_and_checks_after_reopen() {
    let (mut project, instance_id) = project_with_mcu();
    let (_source_dir, source_path) = fixture_path(
        "valid.device-config.json",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.device-config.json"),
    );
    let configuration = load_for_instance(
        &project,
        instance_id,
        &source_path,
        BoardConfigurationSourceFormat::Json,
    )
    .unwrap();
    project.board_configurations.push(configuration);
    assert!(check_all(&project).unwrap().passed);

    let project_dir = tempfile::tempdir().unwrap();
    let project_path = project_dir.path().join("configured.sugeda");
    crate::project::save(&project_path, &project).unwrap();
    let reopened = crate::project::load(&project_path).unwrap();
    assert_eq!(reopened.board_configurations, project.board_configurations);
    assert!(check_all(&reopened).unwrap().passed);
}

#[test]
fn semantic_errors_can_be_saved_and_reported() {
    let (mut project, instance_id) = project_with_mcu();
    let (_source_dir, source_path) = fixture_path(
        "invalid.sugareda.dts",
        include_bytes!("../../../examples/device-configs/test-mcu-invalid.sugareda.dts"),
    );
    let configuration = load_for_instance(
        &project,
        instance_id,
        &source_path,
        BoardConfigurationSourceFormat::DeviceTreeSubset,
    )
    .unwrap();
    project.board_configurations.push(configuration);
    let report = check_all(&project).unwrap();
    assert!(!report.passed);
    assert!(report.entries[0]
        .report
        .issues
        .iter()
        .any(|issue| issue.code == "device-config.signal-conflict"));
}

#[test]
fn upsert_is_undoable_and_replaces_one_configuration_per_instance() {
    let (project, instance_id) = project_with_mcu();
    let (_source_dir, source_path) = fixture_path(
        "valid.device-config.json",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.device-config.json"),
    );
    let configuration = load_for_instance(
        &project,
        instance_id,
        &source_path,
        BoardConfigurationSourceFormat::Json,
    )
    .unwrap();
    let mut workspace = Workspace::new(project);
    workspace
        .upsert_board_configuration(configuration.clone())
        .unwrap();
    let stored_id = workspace.project.board_configurations[0].id;
    let mut replacement = configuration;
    replacement.id = uuid::Uuid::new_v4();
    replacement.source_name = "replacement.device-config.json".into();
    workspace.upsert_board_configuration(replacement).unwrap();
    assert_eq!(workspace.project.board_configurations.len(), 1);
    assert_eq!(workspace.project.board_configurations[0].id, stored_id);
    workspace.undo();
    assert_eq!(
        workspace.project.board_configurations[0].source_name,
        "valid.device-config.json"
    );
    workspace.undo();
    assert!(workspace.project.board_configurations.is_empty());
    workspace.redo();
    assert_eq!(workspace.project.board_configurations.len(), 1);
}

#[test]
fn reports_missing_configuration_and_removes_orphan_binding() {
    let (mut project, instance_id) = project_with_mcu();
    let report = check_all(&project).unwrap();
    assert_eq!(report.unconfigured[0].logical_instance_id, instance_id);
    let (_source_dir, source_path) = fixture_path(
        "valid.device-config.json",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.device-config.json"),
    );
    project.board_configurations.push(
        load_for_instance(
            &project,
            instance_id,
            &source_path,
            BoardConfigurationSourceFormat::Json,
        )
        .unwrap(),
    );
    project.sheets[0].components.clear();
    crate::device_instance::remove_orphans(&mut project);
    assert!(project.device_instances.is_empty());
    assert!(project.board_configurations.is_empty());
}

#[test]
fn rejects_unsafe_persisted_source_metadata() {
    let (project, instance_id) = project_with_mcu();
    let (_source_dir, source_path) = fixture_path(
        "valid.device-config.json",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.device-config.json"),
    );
    let mut configuration = load_for_instance(
        &project,
        instance_id,
        &source_path,
        BoardConfigurationSourceFormat::Json,
    )
    .unwrap();
    configuration.source_name = "../outside.device-config.json".into();
    assert!(super::validate_project_candidate(&project, &configuration).is_err());
    configuration.source_name = "valid.device-config.json".into();
    configuration.source_sha256 = "A".repeat(64);
    assert!(super::validate_project_candidate(&project, &configuration).is_err());
}

#[test]
fn visual_draft_survives_undo_save_reopen_and_export_reimport() {
    let (project, instance_id) = project_with_mcu();
    let config = crate::device_config::parse_ir(include_bytes!(
        "../../../examples/device-configs/test-mcu-valid.device-config.json"
    ))
    .unwrap();
    let configuration = build_from_draft(&project, instance_id, config.clone()).unwrap();
    let mut workspace = Workspace::new(project);
    workspace.upsert_board_configuration(configuration).unwrap();
    assert_eq!(workspace.project.board_configurations.len(), 1);
    assert!(workspace.undo());
    assert!(workspace.project.board_configurations.is_empty());
    assert!(workspace.redo());

    let directory = tempfile::tempdir().unwrap();
    let project_path = directory.path().join("visual-editor.sugeda");
    crate::project::save(&project_path, &workspace.project).unwrap();
    let reopened = crate::project::load(&project_path).unwrap();
    assert_eq!(reopened.board_configurations[0].config, config);

    let export_path = directory.path().join("u1.device-config.json");
    export_configuration(
        &reopened,
        reopened.board_configurations[0].id,
        &export_path,
        BoardConfigurationExportFormat::Json,
    )
    .unwrap();
    let reimported = load_for_instance(
        &reopened,
        instance_id,
        &export_path,
        BoardConfigurationSourceFormat::Json,
    )
    .unwrap();
    assert_eq!(reimported.config, reopened.board_configurations[0].config);
}
