use super::{
    BootStrapAssignment, BootStrapValue, DeviceConfig, DeviceConfigTarget, PinMuxAssignment,
};
use serde::Deserialize;
use thiserror::Error;

const DEVICE_CONFIG_FORMAT_VERSION: u32 = 1;
pub(super) const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_ID_LENGTH: usize = 128;
const MAX_NAME_LENGTH: usize = 256;
const MAX_TEXT_LENGTH: usize = 512;
const MAX_PIN_MUX_ASSIGNMENTS: usize = 4096;
const MAX_BOOT_STRAPS: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsonDeviceConfig {
    format_version: u32,
    id: String,
    name: String,
    source: String,
    license: String,
    target: JsonDeviceConfigTarget,
    #[serde(default)]
    pin_mux: Vec<JsonPinMuxAssignment>,
    #[serde(default)]
    boot_straps: Vec<JsonBootStrapAssignment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsonDeviceConfigTarget {
    pack_id: String,
    pack_version: String,
    device_id: String,
    #[serde(default)]
    variant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsonPinMuxAssignment {
    pin_id: String,
    function: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JsonBootStrapAssignment {
    pin_id: String,
    value: JsonBootStrapValue,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum JsonBootStrapValue {
    Low,
    High,
    PullDown,
    PullUp,
    External,
}

#[derive(Debug, Error)]
pub enum DeviceConfigError {
    #[error("[device-config.extension] Device configuration must use .device-config.json")]
    Extension,
    #[error("[device-config.io] Cannot read device configuration: {0}")]
    Io(#[from] std::io::Error),
    #[error("[device-config.too-large] Device configuration exceeds the 1 MiB limit")]
    TooLarge,
    #[error("[device-config.json] Invalid device configuration JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("[{code}] {message}")]
    Invalid { code: &'static str, message: String },
}

impl DeviceConfigError {
    pub(super) fn invalid(code: &'static str, message: impl Into<String>) -> Self {
        Self::Invalid {
            code,
            message: message.into(),
        }
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<DeviceConfig, DeviceConfigError> {
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err(DeviceConfigError::TooLarge);
    }
    let source: JsonDeviceConfig = serde_json::from_slice(bytes)?;
    Ok(into_ir(source))
}

fn into_ir(source: JsonDeviceConfig) -> DeviceConfig {
    DeviceConfig {
        format_version: source.format_version,
        id: source.id,
        name: source.name,
        source: source.source,
        license: source.license,
        target: DeviceConfigTarget {
            pack_id: source.target.pack_id,
            pack_version: source.target.pack_version,
            device_id: source.target.device_id,
            variant_id: source.target.variant_id,
        },
        pin_mux: source
            .pin_mux
            .into_iter()
            .map(|assignment| PinMuxAssignment {
                pin_id: assignment.pin_id,
                function: assignment.function,
            })
            .collect(),
        boot_straps: source
            .boot_straps
            .into_iter()
            .map(|strap| BootStrapAssignment {
                pin_id: strap.pin_id,
                value: match strap.value {
                    JsonBootStrapValue::Low => BootStrapValue::Low,
                    JsonBootStrapValue::High => BootStrapValue::High,
                    JsonBootStrapValue::PullDown => BootStrapValue::PullDown,
                    JsonBootStrapValue::PullUp => BootStrapValue::PullUp,
                    JsonBootStrapValue::External => BootStrapValue::External,
                },
            })
            .collect(),
    }
}

pub(crate) fn validate(config: &DeviceConfig) -> Result<(), DeviceConfigError> {
    if config.format_version != DEVICE_CONFIG_FORMAT_VERSION {
        return Err(DeviceConfigError::invalid(
            "device-config.unsupported-version",
            format!(
                "Unsupported format version {}; expected {}",
                config.format_version, DEVICE_CONFIG_FORMAT_VERSION
            ),
        ));
    }
    validate_identifier("configuration id", &config.id)?;
    validate_text("configuration name", &config.name, MAX_NAME_LENGTH)?;
    validate_text("source", &config.source, MAX_TEXT_LENGTH)?;
    validate_text("license", &config.license, MAX_TEXT_LENGTH)?;
    validate_identifier("target pack id", &config.target.pack_id)?;
    validate_identifier("target pack version", &config.target.pack_version)?;
    validate_identifier("target device id", &config.target.device_id)?;
    if let Some(variant_id) = &config.target.variant_id {
        validate_identifier("target variant id", variant_id)?;
    }
    if config.pin_mux.len() > MAX_PIN_MUX_ASSIGNMENTS {
        return Err(DeviceConfigError::invalid(
            "device-config.too-many-pinmux-assignments",
            format!("PinMux assignment count exceeds {MAX_PIN_MUX_ASSIGNMENTS}"),
        ));
    }
    if config.boot_straps.len() > MAX_BOOT_STRAPS {
        return Err(DeviceConfigError::invalid(
            "device-config.too-many-boot-straps",
            format!("Boot strap count exceeds {MAX_BOOT_STRAPS}"),
        ));
    }
    for assignment in &config.pin_mux {
        validate_identifier("PinMux pin id", &assignment.pin_id)?;
        validate_identifier("PinMux function", &assignment.function)?;
    }
    for strap in &config.boot_straps {
        validate_identifier("boot strap pin id", &strap.pin_id)?;
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<(), DeviceConfigError> {
    if value.is_empty()
        || value.len() > MAX_ID_LENGTH
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '+')
        })
    {
        return Err(DeviceConfigError::invalid(
            "device-config.invalid-identifier",
            format!("{label} must be 1-{MAX_ID_LENGTH} safe ASCII characters"),
        ));
    }
    Ok(())
}

fn validate_text(label: &str, value: &str, max_length: usize) -> Result<(), DeviceConfigError> {
    if value.is_empty() || value.len() > max_length || value.chars().any(char::is_control) {
        return Err(DeviceConfigError::invalid(
            "device-config.invalid-text",
            format!("{label} must be 1-{max_length} characters without control characters"),
        ));
    }
    Ok(())
}
