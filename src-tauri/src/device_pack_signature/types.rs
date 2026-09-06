use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DetachedDevicePackSignature {
    pub format_version: u32,
    pub algorithm: String,
    pub key_id: String,
    pub signer: String,
    pub pack_sha256: String,
    pub public_key_base64: String,
    pub signature_base64: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePackSignatureReport {
    pub verified: bool,
    pub trusted_identity: bool,
    pub algorithm: String,
    pub key_id: String,
    pub signer: String,
    pub pack_sha256: String,
    pub public_key_fingerprint: String,
    pub code: String,
    pub message_zh: String,
    pub message_en: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrustedDevicePackKey {
    pub key_id: String,
    pub signer: String,
    pub public_key_base64: String,
    pub fingerprint: String,
    pub trusted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PortableTrustedDevicePackKey {
    pub format_version: u32,
    pub key_id: String,
    pub signer: String,
    pub public_key_base64: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustedDevicePackKeyExportReceipt {
    pub path: String,
    pub fingerprint: String,
}
