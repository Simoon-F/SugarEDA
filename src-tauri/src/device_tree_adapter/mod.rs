//! Strict, read-only Device Tree subset adapter.
//!
//! This is intentionally not a general DTS parser. It accepts only standalone
//! `*.sugareda.dts` files using the documented SugarEDA node vocabulary, then
//! converts them into the same vendor-neutral IR used by JSON configuration.

mod converter;
mod diagnostic;
mod lexer;
mod parser;

use crate::{device_config, domain::Project};
use serde::Serialize;
use std::{fs, path::Path};
use thiserror::Error;

pub use converter::DeviceTreeSourceLocation;
pub use diagnostic::DeviceTreeDiagnostic;

const MAX_DEVICE_TREE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTreeAdapterReport {
    pub adapter: &'static str,
    pub source_name: String,
    pub translated: bool,
    pub valid: bool,
    pub translated_assignments: usize,
    pub config_report: Option<device_config::DeviceConfigReport>,
    pub source_locations: Vec<DeviceTreeSourceLocation>,
    pub issues: Vec<DeviceTreeDiagnostic>,
}

#[derive(Debug, Error)]
pub enum DeviceTreeAdapterError {
    #[error("[device-tree.extension] Device Tree subset input must use .sugareda.dts")]
    Extension,
    #[error("[device-tree.io] Cannot read Device Tree subset input: {0}")]
    Io(#[from] std::io::Error),
    #[error("[device-tree.too-large] Device Tree subset input exceeds the 1 MiB limit")]
    TooLarge,
    #[error(transparent)]
    Config(#[from] device_config::DeviceConfigError),
}

pub fn check_file(
    project: &Project,
    pack_sha256: &str,
    device_id: &str,
    path: &Path,
) -> Result<DeviceTreeAdapterReport, DeviceTreeAdapterError> {
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("device-tree")
        .to_owned();
    if !source_name.ends_with(".sugareda.dts") {
        return Err(DeviceTreeAdapterError::Extension);
    }
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(DeviceTreeAdapterError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "selected input is not a regular file",
        )));
    }
    if metadata.len() > MAX_DEVICE_TREE_BYTES {
        return Err(DeviceTreeAdapterError::TooLarge);
    }
    let bytes = fs::read(path)?;
    check_bytes(project, pack_sha256, device_id, &source_name, &bytes)
}

pub fn check_bytes(
    project: &Project,
    pack_sha256: &str,
    device_id: &str,
    source_name: &str,
    bytes: &[u8],
) -> Result<DeviceTreeAdapterReport, DeviceTreeAdapterError> {
    if bytes.len() as u64 > MAX_DEVICE_TREE_BYTES {
        return Err(DeviceTreeAdapterError::TooLarge);
    }
    let tokens = match lexer::lex(bytes) {
        Ok(tokens) => tokens,
        Err(issue) => return Ok(failed_report(source_name, issue)),
    };
    let parsed = match parser::parse(tokens) {
        Ok(parsed) => parsed,
        Err(issue) => return Ok(failed_report(source_name, issue)),
    };
    let converted = match converter::convert(parsed) {
        Ok(converted) => converted,
        Err(issue) => return Ok(failed_report(source_name, issue)),
    };
    let translated_assignments =
        converted.config.pin_mux.len() + converted.config.boot_straps.len();
    let config_report =
        device_config::check_ir(project, pack_sha256, device_id, &converted.config)?;
    Ok(DeviceTreeAdapterReport {
        adapter: "sugaredaDeviceTreeSubsetV1",
        source_name: source_name.to_owned(),
        translated: true,
        valid: config_report.valid,
        translated_assignments,
        config_report: Some(config_report),
        source_locations: converted.locations,
        issues: Vec::new(),
    })
}

fn failed_report(source_name: &str, issue: DeviceTreeDiagnostic) -> DeviceTreeAdapterReport {
    DeviceTreeAdapterReport {
        adapter: "sugaredaDeviceTreeSubsetV1",
        source_name: source_name.to_owned(),
        translated: false,
        valid: false,
        translated_assignments: 0,
        config_report: None,
        source_locations: Vec::new(),
        issues: vec![issue],
    }
}

#[cfg(test)]
mod tests;
