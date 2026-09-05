//! Vendor-neutral L5 device configuration validation.
//!
//! SDK-specific integrations may translate into this restricted IR in future
//! stages. The current JSON reader and Device Tree subset adapter remain
//! independent bounded parsers; this module owns the shared semantic rules.

mod checker;
mod diagnostic;
mod format;
mod ir;
mod pack_rules;
mod pin_rules;
mod voltage_rules;

use crate::{device_pack::DeviceDefinition, device_pack::EmbeddedDevicePack, domain::Project};
use std::{fs, path::Path};

pub(crate) use diagnostic::DeviceConfigIssue;
pub use diagnostic::DeviceConfigReport;
pub use format::DeviceConfigError;
use format::{parse, MAX_CONFIG_BYTES};
pub(crate) use ir::{
    BootStrapAssignment, BootStrapValue, DeviceConfig, DeviceConfigTarget, PinMuxAssignment,
    VoltageSelection,
};

pub fn check_file(
    project: &Project,
    pack_sha256: &str,
    device_id: &str,
    path: &Path,
) -> Result<DeviceConfigReport, DeviceConfigError> {
    if !path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".device-config.json"))
    {
        return Err(DeviceConfigError::Extension);
    }
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(DeviceConfigError::invalid(
            "device-config.not-file",
            "Selected configuration is not a regular file",
        ));
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(DeviceConfigError::TooLarge);
    }
    let bytes = fs::read(path)?;
    check_bytes(project, pack_sha256, device_id, &bytes)
}

pub fn check_bytes(
    project: &Project,
    pack_sha256: &str,
    device_id: &str,
    bytes: &[u8],
) -> Result<DeviceConfigReport, DeviceConfigError> {
    let config = parse(bytes)?;
    check_ir(project, pack_sha256, device_id, &config)
}

pub(crate) fn parse_ir(bytes: &[u8]) -> Result<DeviceConfig, DeviceConfigError> {
    parse(bytes)
}

pub(crate) fn validate_ir(config: &DeviceConfig) -> Result<(), DeviceConfigError> {
    format::validate(config)
}

pub(crate) fn check_ir(
    project: &Project,
    pack_sha256: &str,
    device_id: &str,
    config: &DeviceConfig,
) -> Result<DeviceConfigReport, DeviceConfigError> {
    format::validate(config)?;
    let (embedded, device) = selected_device(project, pack_sha256, device_id)?;
    Ok(checker::check(config, embedded, device))
}

fn selected_device<'a>(
    project: &'a Project,
    pack_sha256: &str,
    device_id: &str,
) -> Result<(&'a EmbeddedDevicePack, &'a DeviceDefinition), DeviceConfigError> {
    let embedded = project
        .device_packs
        .iter()
        .find(|pack| pack.sha256 == pack_sha256)
        .ok_or_else(|| {
            DeviceConfigError::invalid(
                "device-config.pack-unavailable",
                "Device pack is not embedded in this project",
            )
        })?;
    let device = embedded
        .pack
        .devices
        .iter()
        .find(|device| device.id == device_id)
        .ok_or_else(|| {
            DeviceConfigError::invalid(
                "device-config.device-unavailable",
                format!("Device '{device_id}' is unavailable in the selected pack"),
            )
        })?;
    Ok((embedded, device))
}

#[cfg(test)]
mod tests;
