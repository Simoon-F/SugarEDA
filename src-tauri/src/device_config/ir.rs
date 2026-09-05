use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceConfig {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub source: String,
    pub license: String,
    pub target: DeviceConfigTarget,
    #[serde(default)]
    pub pin_mux: Vec<PinMuxAssignment>,
    #[serde(default)]
    pub boot_straps: Vec<BootStrapAssignment>,
    #[serde(default)]
    pub voltage_selections: Vec<VoltageSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeviceConfigTarget {
    pub pack_id: String,
    pub pack_version: String,
    pub device_id: String,
    pub variant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PinMuxAssignment {
    pub pin_id: String,
    pub function: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BootStrapAssignment {
    pub pin_id: String,
    pub value: BootStrapValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BootStrapValue {
    Low,
    High,
    PullDown,
    PullUp,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VoltageSelection {
    pub domain_id: String,
    pub voltage: f64,
}
