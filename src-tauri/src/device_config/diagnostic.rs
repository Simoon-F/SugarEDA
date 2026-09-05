use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigReport {
    pub valid: bool,
    pub format_version: u32,
    pub config_id: String,
    pub config_name: String,
    pub pack_sha256: String,
    pub device_id: String,
    pub checked_assignments: usize,
    pub issues: Vec<DeviceConfigIssue>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigIssue {
    pub code: &'static str,
    pub severity: &'static str,
    pub pin_id: Option<String>,
    pub domain_id: Option<String>,
    pub message_zh: String,
    pub message_en: String,
}

pub(super) fn pin_issue(
    code: &'static str,
    pin_id: Option<&str>,
    message_zh: impl Into<String>,
    message_en: impl Into<String>,
) -> DeviceConfigIssue {
    DeviceConfigIssue {
        code,
        severity: "error",
        pin_id: pin_id.map(str::to_owned),
        domain_id: None,
        message_zh: message_zh.into(),
        message_en: message_en.into(),
    }
}

pub(super) fn domain_issue(
    code: &'static str,
    domain_id: &str,
    message_zh: impl Into<String>,
    message_en: impl Into<String>,
) -> DeviceConfigIssue {
    DeviceConfigIssue {
        code,
        severity: "error",
        pin_id: None,
        domain_id: Some(domain_id.to_owned()),
        message_zh: message_zh.into(),
        message_en: message_en.into(),
    }
}
