use crate::{device_config::DeviceConfig, device_config::DeviceConfigReport};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BoardConfiguration {
    pub id: Uuid,
    pub logical_instance_id: Uuid,
    pub source_format: BoardConfigurationSourceFormat,
    pub source_name: String,
    pub source_sha256: String,
    pub config: DeviceConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BoardConfigurationSourceFormat {
    Json,
    DeviceTreeSubset,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoardConfigurationCheckReport {
    pub passed: bool,
    pub eligible_instances: usize,
    pub configured_instances: usize,
    pub entries: Vec<BoardConfigurationCheckEntry>,
    pub unconfigured: Vec<UnconfiguredDeviceInstance>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoardConfigurationCheckEntry {
    pub board_configuration_id: Uuid,
    pub logical_instance_id: Uuid,
    pub reference: String,
    pub source_name: String,
    pub source_format: BoardConfigurationSourceFormat,
    pub report: DeviceConfigReport,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnconfiguredDeviceInstance {
    pub logical_instance_id: Uuid,
    pub reference: String,
    pub device_id: String,
    pub code: &'static str,
    pub message_zh: String,
    pub message_en: String,
}
