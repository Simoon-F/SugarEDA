//! Detached DevicePack signature verification without an implicit trust claim.

mod commands;
mod trust_store;
mod types;
mod verify;

pub(crate) use commands::{
    inspect_device_pack_signature, list_trusted_device_pack_keys, remove_trusted_device_pack_key,
    trust_device_pack_signature_key,
};
use trust_store::DevicePackTrustStore;
use types::{DetachedDevicePackSignature, DevicePackSignatureReport, TrustedDevicePackKey};
use verify::{inspect_files, read_signature_envelope};
