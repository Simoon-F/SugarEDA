use super::{check_bytes, DeviceTreeAdapterError, MAX_DEVICE_TREE_BYTES};
use crate::domain::Project;
use std::collections::BTreeSet;

fn project_with_mcu() -> (Project, String) {
    let pack = crate::device_pack::import_bytes(include_bytes!(
        "../../../examples/devicepacks/test-mcu.devicepack.json"
    ))
    .unwrap();
    let hash = pack.sha256.clone();
    let mut project = Project::blank("device tree adapter");
    project.device_packs.push(pack);
    (project, hash)
}

#[test]
fn translates_valid_subset_into_the_shared_config_checker() {
    let (project, hash) = project_with_mcu();
    let report = check_bytes(
        &project,
        &hash,
        "stmcu24",
        "valid.sugareda.dts",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.sugareda.dts"),
    )
    .unwrap();
    assert!(report.translated);
    assert!(report.valid);
    assert_eq!(report.translated_assignments, 5);
    assert_eq!(report.source_locations.len(), 5);
    assert_eq!(report.config_report.unwrap().checked_assignments, 5);
}

#[test]
fn preserves_shared_semantic_diagnostic_codes() {
    let (project, hash) = project_with_mcu();
    let report = check_bytes(
        &project,
        &hash,
        "stmcu24",
        "invalid.sugareda.dts",
        include_bytes!("../../../examples/device-configs/test-mcu-invalid.sugareda.dts"),
    )
    .unwrap();
    let codes = report
        .config_report
        .unwrap()
        .issues
        .into_iter()
        .map(|issue| issue.code)
        .collect::<BTreeSet<_>>();
    assert!(codes.contains("device-config.unsupported-function"));
    assert!(codes.contains("device-config.signal-conflict"));
    assert!(codes.contains("device-config.boot-pin-unconfigured"));
}

#[test]
fn rejects_include_directives_and_unknown_properties() {
    let (project, hash) = project_with_mcu();
    let include = br#"/dts-v1/; /include/ "foreign.dtsi" / { };"#;
    let report = check_bytes(&project, &hash, "stmcu24", "include.sugareda.dts", include).unwrap();
    assert!(!report.translated);
    assert_eq!(report.issues[0].code, "device-tree.unexpected-token");

    let unknown = br#"/dts-v1/; / { sugareda-device-config {
      compatible = "sugareda,device-config-v1"; execute = "tool";
    }; };"#;
    let report = check_bytes(&project, &hash, "stmcu24", "unknown.sugareda.dts", unknown).unwrap();
    assert_eq!(report.issues[0].code, "device-tree.unknown-property");
}

#[test]
fn reports_locations_for_lexical_and_structural_errors() {
    let (project, hash) = project_with_mcu();
    let invalid_character = b"/dts-v1/;\n/ { &foreign {}; };";
    let report = check_bytes(
        &project,
        &hash,
        "stmcu24",
        "invalid.sugareda.dts",
        invalid_character,
    )
    .unwrap();
    assert_eq!(report.issues[0].code, "device-tree.invalid-character");
    assert_eq!(report.issues[0].line, Some(2));
    assert!(report.issues[0].column.is_some());
}

#[test]
fn enforces_input_size_before_lexing() {
    let (project, hash) = project_with_mcu();
    let bytes = vec![b' '; MAX_DEVICE_TREE_BYTES as usize + 1];
    assert!(matches!(
        check_bytes(&project, &hash, "stmcu24", "large.sugareda.dts", &bytes),
        Err(DeviceTreeAdapterError::TooLarge)
    ));
}
