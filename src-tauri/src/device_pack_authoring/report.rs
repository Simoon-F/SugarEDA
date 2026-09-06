use crate::device_pack::{self, DevicePack, DevicePackError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePackAuthoringReport {
    pub valid: bool,
    pub pack_sha256: Option<String>,
    pub device_count: usize,
    pub pin_count: usize,
    pub issues: Vec<DevicePackAuthoringIssue>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePackAuthoringIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePackExportReceipt {
    pub path: String,
    pub bytes_written: usize,
    pub pack_sha256: String,
}

pub(super) fn inspect_draft(pack: &DevicePack) -> DevicePackAuthoringReport {
    let issue = device_pack::validate(pack).err().map(issue_from_error);
    DevicePackAuthoringReport {
        valid: issue.is_none(),
        pack_sha256: issue.is_none().then(|| device_pack::content_hash(pack)),
        device_count: pack.devices.len(),
        pin_count: pack.devices.iter().map(|device| device.pins.len()).sum(),
        issues: issue.into_iter().collect(),
    }
}

fn issue_from_error(error: DevicePackError) -> DevicePackAuthoringIssue {
    let code = match &error {
        DevicePackError::Extension => "device-pack.extension",
        DevicePackError::TooLarge => "device-pack.too-large",
        DevicePackError::Read(_) => "device-pack.read",
        DevicePackError::Json(_) => "device-pack.json",
        DevicePackError::FormatVersion(_) => "device-pack.unsupported-version",
        DevicePackError::Invalid { code, .. } => code,
        DevicePackError::Unsafe(_) => "device-pack.unsafe-content",
    };
    DevicePackAuthoringIssue {
        code: code.to_owned(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_invalid_cross_references_without_producing_a_hash() {
        let mut embedded = crate::device_pack::import_bytes(include_bytes!(
            "../../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        embedded.pack.devices[0].package_id = "missing-package".into();

        let report = inspect_draft(&embedded.pack);
        assert!(!report.valid);
        assert!(report.pack_sha256.is_none());
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].code, "missing_reference");
    }

    #[test]
    fn accepts_an_advanced_multi_unit_spice_draft() {
        let pack: DevicePack = serde_json::from_value(serde_json::json!({
            "manifest": {
                "formatVersion": 1,
                "id": "org.sugareda.test.authored",
                "name": "Authored advanced test",
                "vendor": "SugarEDA Test Devices",
                "version": "1.0.0",
                "source": "Self-contained test data",
                "license": "CC0-1.0",
                "description": "Advanced authoring validation fixture"
            },
            "devices": [{
                "id": "device",
                "name": "Test device",
                "deviceType": "integrated-circuit",
                "symbolId": "symbol",
                "packageId": "package",
                "variants": [],
                "pins": [
                    { "id": "pin1", "number": "1", "name": "IN_P", "group": "ANALOG", "electricalType": "input", "direction": "input" },
                    { "id": "pin2", "number": "2", "name": "IN_N", "group": "POWER", "electricalType": "input", "direction": "input" }
                ],
                "voltageDomains": [],
                "alternateFunctions": [],
                "differentialPairs": [{ "id": "diff1", "positivePinId": "pin1", "negativePinId": "pin2" }],
                "rules": [],
                "configurationRules": [],
                "modelIds": ["spice-model-1", "ibis-model-2"],
                "spiceBindings": [{
                    "modelId": "spice-model-1",
                    "ports": [
                        { "modelPort": "P1", "pinId": "pin1" },
                        { "modelPort": "P2", "pinId": "pin2" }
                    ]
                }],
                "sdkAdapterIds": []
            }],
            "symbols": [{
                "id": "symbol",
                "name": "Generated symbol",
                "units": [
                    { "id": "analog", "name": "Analog", "groups": ["ANALOG"] },
                    { "id": "power", "name": "Power", "groups": ["POWER"] }
                ]
            }],
            "packages": [{ "id": "package", "name": "Package", "kind": "generic", "pads": ["1", "2"] }],
            "models": [
                {
                    "id": "spice-model-1",
                    "kind": "spice",
                    "format": "spice-subcircuit",
                    "modelName": "SUGAR_MODEL_1",
                    "embeddedContent": "* SugarEDA test model\n.subckt SUGAR_MODEL_1 P1 P2\nRLEAK P1 P2 1T\n.ends SUGAR_MODEL_1\n",
                    "metadata": { "license": "CC0-1.0" }
                },
                {
                    "id": "ibis-model-2",
                    "kind": "ibis",
                    "format": "ibis-metadata",
                    "metadata": { "license": "CC0-1.0" }
                }
            ],
            "sdkAdapters": [],
            "documents": [{
                "kind": "datasheet",
                "title": "Test source",
                "sourceUrl": "https://example.invalid/test",
                "revision": "1.0",
                "license": "CC0-1.0"
            }]
        }))
        .unwrap();

        let report = inspect_draft(&pack);
        assert!(report.valid, "{:?}", report.issues);
        assert!(report.pack_sha256.is_some());
        assert_eq!(report.pin_count, 2);
    }
}
