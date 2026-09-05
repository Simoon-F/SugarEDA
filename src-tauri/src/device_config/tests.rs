use super::{check_bytes, format::DeviceConfigError, format::MAX_CONFIG_BYTES};
use crate::domain::Project;
use std::collections::BTreeSet;

fn project_with_mcu() -> (Project, String) {
    let pack = crate::device_pack::import_bytes(include_bytes!(
        "../../../examples/devicepacks/test-mcu.devicepack.json"
    ))
    .unwrap();
    let hash = pack.sha256.clone();
    let mut project = Project::blank("device config");
    project.device_packs.push(pack);
    (project, hash)
}

#[test]
fn accepts_valid_vendor_neutral_configuration() {
    let (project, hash) = project_with_mcu();
    let report = check_bytes(
        &project,
        &hash,
        "stmcu24",
        include_bytes!("../../../examples/device-configs/test-mcu-valid.device-config.json"),
    )
    .unwrap();
    assert!(report.valid);
    assert_eq!(report.checked_assignments, 7);
    assert!(report.issues.is_empty());
}

#[test]
fn reports_pinmux_boot_and_signal_conflicts_with_stable_codes() {
    let (project, hash) = project_with_mcu();
    let report = check_bytes(
        &project,
        &hash,
        "stmcu24",
        include_bytes!("../../../examples/device-configs/test-mcu-invalid.device-config.json"),
    )
    .unwrap();
    assert!(!report.valid);
    let codes = report
        .issues
        .iter()
        .map(|issue| issue.code)
        .collect::<BTreeSet<_>>();
    assert!(codes.contains("device-config.unknown-pin"));
    assert!(codes.contains("device-config.unsupported-function"));
    assert!(codes.contains("device-config.signal-conflict"));
    assert!(codes.contains("device-config.boot-pin-unconfigured"));
    assert!(codes.contains("device-config.voltage-out-of-range"));
    assert!(codes.contains("device-config.duplicate-voltage-selection"));
    assert!(codes.contains("device-config.unknown-voltage-domain"));
    assert!(codes.contains("device-config.required-functions-missing"));
}

#[test]
fn rejects_unknown_fields_and_unsupported_versions() {
    let (project, hash) = project_with_mcu();
    let unknown = br#"{
      "formatVersion":1,"id":"test","name":"test","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24"},
      "pinMux":[],"bootStraps":[],"execute":"bad"
    }"#;
    assert!(matches!(
        check_bytes(&project, &hash, "stmcu24", unknown),
        Err(DeviceConfigError::Json(_))
    ));
    let unsupported = br#"{
      "formatVersion":2,"id":"test","name":"test","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24"},
      "pinMux":[],"bootStraps":[]
    }"#;
    assert!(matches!(
        check_bytes(&project, &hash, "stmcu24", unsupported),
        Err(DeviceConfigError::Invalid {
            code: "device-config.unsupported-version",
            ..
        })
    ));
}

#[test]
fn reports_target_mismatch_without_applying_foreign_assignments() {
    let (project, hash) = project_with_mcu();
    let foreign = br#"{
      "formatVersion":1,"id":"test","name":"test","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.example.foreign","packVersion":"9.0.0","deviceId":"other"},
      "pinMux":[{"pinId":"foreign-pin","function":"FOREIGN_FN"}],"bootStraps":[]
    }"#;
    let report = check_bytes(&project, &hash, "stmcu24", foreign).unwrap();
    let codes = report
        .issues
        .iter()
        .map(|issue| issue.code)
        .collect::<BTreeSet<_>>();
    assert!(codes.contains("device-config.target-pack-mismatch"));
    assert!(codes.contains("device-config.target-version-mismatch"));
    assert!(codes.contains("device-config.target-device-mismatch"));
    assert!(!codes.contains("device-config.unknown-pin"));
}

#[test]
fn reports_duplicate_assignments_and_boot_pinmux_overlap() {
    let (project, hash) = project_with_mcu();
    let conflicting = br#"{
      "formatVersion":1,"id":"test","name":"test","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24"},
      "pinMux":[
        {"pinId":"pa0","function":"GPIO_A0"},
        {"pinId":"pa0","function":"UART1_TX"},
        {"pinId":"boot0","function":"GPIO_A0"}
      ],
      "bootStraps":[
        {"pinId":"boot0","value":"low"},
        {"pinId":"boot0","value":"high"},
        {"pinId":"missing","value":"external"}
      ]
    }"#;
    let report = check_bytes(&project, &hash, "stmcu24", conflicting).unwrap();
    let codes = report
        .issues
        .iter()
        .map(|issue| issue.code)
        .collect::<BTreeSet<_>>();
    assert!(codes.contains("device-config.duplicate-pin-assignment"));
    assert!(codes.contains("device-config.duplicate-boot-strap"));
    assert!(codes.contains("device-config.unknown-boot-pin"));
    assert!(codes.contains("device-config.boot-pinmux-conflict"));
}

#[test]
fn enforces_size_limit_before_json_parsing() {
    let (project, hash) = project_with_mcu();
    let bytes = vec![b' '; MAX_CONFIG_BYTES as usize + 1];
    assert!(matches!(
        check_bytes(&project, &hash, "stmcu24", &bytes),
        Err(DeviceConfigError::TooLarge)
    ));
}

#[test]
fn rejects_structurally_unsafe_voltage_values() {
    let (project, hash) = project_with_mcu();
    let invalid = br#"{
      "formatVersion":1,"id":"voltage","name":"voltage","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24"},
      "pinMux":[],"bootStraps":[],
      "voltageSelections":[{"domainId":"vdd","voltage":100001}]
    }"#;
    assert!(matches!(
        check_bytes(&project, &hash, "stmcu24", invalid),
        Err(DeviceConfigError::Invalid {
            code: "device-config.invalid-voltage",
            ..
        })
    ));
}

#[test]
fn enforces_pack_declared_function_groups_dependencies_and_voltage_domains() {
    let (project, hash) = project_with_mcu();
    let incomplete = br#"{
      "formatVersion":1,"id":"structured-rules","name":"structured rules","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24","variantId":"industrial"},
      "pinMux":[
        {"pinId":"pa0","function":"UART1_TX"},
        {"pinId":"pa1","function":"UART2_RX"},
        {"pinId":"pa4","function":"SPI1_MOSI"},
        {"pinId":"pa8","function":"TIM1_CH1"}
      ],
      "bootStraps":[{"pinId":"boot0","value":"pullDown"}],
      "voltageSelections":[{"domainId":"vdd","voltage":3.3}]
    }"#;
    let report = check_bytes(&project, &hash, "stmcu24", incomplete).unwrap();
    let codes = report
        .issues
        .iter()
        .map(|issue| issue.code)
        .collect::<BTreeSet<_>>();
    assert!(codes.contains("device-config.incomplete-function-group"));
    assert!(codes.contains("device-config.mutually-exclusive-functions"));
    assert!(codes.contains("device-config.function-dependency-unsatisfied"));

    let missing_voltage = br#"{
      "formatVersion":1,"id":"missing-voltage","name":"missing voltage","source":"test","license":"CC0-1.0",
      "target":{"packId":"org.sugareda.test.mcu","packVersion":"1.0.0","deviceId":"stmcu24","variantId":"industrial"},
      "pinMux":[{"pinId":"pa0","function":"UART1_TX"},{"pinId":"pa2","function":"UART1_RX"}],
      "bootStraps":[{"pinId":"boot0","value":"pullDown"}],
      "voltageSelections":[]
    }"#;
    let report = check_bytes(&project, &hash, "stmcu24", missing_voltage).unwrap();
    assert!(report.issues.iter().any(|issue| {
        issue.code == "device-config.required-voltage-domain-missing"
            && issue.domain_id.as_deref() == Some("vdd")
    }));
}
