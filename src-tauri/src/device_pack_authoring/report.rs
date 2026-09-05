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
}
