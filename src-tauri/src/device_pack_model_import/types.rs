use crate::domain::SpiceModelDefinition;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePackSpiceModelFileReport {
    pub source_file_name: String,
    pub bytes: u64,
    pub sha256: String,
    pub definitions: Vec<SpiceModelDefinition>,
    pub embedded_content: String,
}
