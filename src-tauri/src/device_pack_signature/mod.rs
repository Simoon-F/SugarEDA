//! Detached DevicePack signature verification without an implicit trust claim.

mod commands;
mod trust_store;
mod types;
mod verify;

pub(crate) use commands::{
    export_trusted_device_pack_key, import_trusted_device_pack_key, inspect_device_pack_signature,
    list_trusted_device_pack_keys, remove_trusted_device_pack_key, trust_device_pack_signature_key,
};
use trust_store::DevicePackTrustStore;
use types::{
    DetachedDevicePackSignature, DevicePackSignatureReport, PortableTrustedDevicePackKey,
    TrustedDevicePackKey, TrustedDevicePackKeyExportReceipt,
};
use verify::{inspect_files, read_signature_envelope};
