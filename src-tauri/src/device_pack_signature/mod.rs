//! Detached DevicePack signature verification without an implicit trust claim.

mod commands;
mod types;
mod verify;

pub(crate) use commands::inspect_device_pack_signature;
use types::{DetachedDevicePackSignature, DevicePackSignatureReport};
use verify::inspect_files;
