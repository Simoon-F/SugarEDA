use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterContractManifest {
    pub contract_version: u32,
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub license: String,
    pub source: String,
    pub adapter_kind: AdapterKind,
    pub input_kinds: Vec<AdapterInputKind>,
    pub output_kind: AdapterOutputKind,
    pub supported_pack_ids: Vec<String>,
    pub permissions: AdapterContractPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdapterKind {
    DeviceConfigurationTranslator,
    DeviceTreeTranslator,
    SdkMetadataBridge,
    SignalIntegrityMetadataBridge,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdapterInputKind {
    DeviceConfigurationIrV1,
    SugarEdaDeviceTreeSubsetV1,
    SelectedSdkRootMetadataV1,
    IbisMetadataV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdapterOutputKind {
    DeviceConfigurationIrV1,
    DeviceTreeReviewV1,
    SignalIntegrityMetadataV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterContractPermissions {
    pub selected_sdk_root_read: bool,
    pub project_files_read: bool,
    pub network_access: bool,
    pub process_execution: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterRequestEnvelope {
    pub contract_version: u32,
    pub request_id: String,
    pub pack_id: String,
    pub pack_version: String,
    pub device_id: String,
    pub variant_id: Option<String>,
    pub input_kind: AdapterInputKind,
    pub input_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterResponseEnvelope {
    pub contract_version: u32,
    pub request_id: String,
    pub output_kind: AdapterOutputKind,
    pub output: serde_json::Value,
    pub diagnostics: Vec<AdapterDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterDiagnostic {
    pub code: String,
    pub severity: String,
    pub message_zh: String,
    pub message_en: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterContractReport {
    pub valid: bool,
    pub execution_available: bool,
    pub manifest: Option<AdapterContractManifest>,
    pub code: String,
    pub message_zh: String,
    pub message_en: String,
}
