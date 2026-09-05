//! Versioned, vendor-neutral device-pack format and defensive importer.
//!
//! A pack is data only.  It is embedded into the project after validation; no
//! script, executable, external model path, or implicit network dependency is
//! accepted here.

use crate::domain::{
    DeviceBinding, ModelBinding, Pin, PinElectricalType, Point, Project, SpiceLibrary,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
use thiserror::Error;
use uuid::Uuid;

pub const DEVICE_PACK_FORMAT_VERSION: u32 = 1;
const MAX_PACK_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STRING: usize = 512;
const MAX_DOCUMENT_URL: usize = 2048;
const MAX_DEVICES: usize = 4096;
const MAX_PINS_PER_DEVICE: usize = 4096;
const MAX_TOTAL_PINS: usize = 50_000;
const MAX_MODELS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevicePack {
    pub manifest: DevicePackManifest,
    pub devices: Vec<DeviceDefinition>,
    #[serde(default)]
    pub symbols: Vec<SymbolDefinition>,
    #[serde(default)]
    pub packages: Vec<PackageDefinition>,
    #[serde(default)]
    pub models: Vec<DeviceModel>,
    #[serde(default)]
    pub sdk_adapters: Vec<SdkAdapterMetadata>,
    #[serde(default)]
    pub documents: Vec<DocumentMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevicePackManifest {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub source: String,
    pub license: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceDefinition {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub symbol_id: String,
    pub package_id: String,
    #[serde(default)]
    pub variants: Vec<DeviceVariant>,
    pub pins: Vec<DevicePin>,
    #[serde(default)]
    pub voltage_domains: Vec<VoltageDomain>,
    #[serde(default)]
    pub alternate_functions: Vec<AlternateFunction>,
    #[serde(default)]
    pub differential_pairs: Vec<DifferentialPair>,
    #[serde(default)]
    pub rules: Vec<DeviceRule>,
    #[serde(default)]
    pub model_ids: Vec<String>,
    #[serde(default)]
    pub sdk_adapter_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceVariant {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub package_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub units: Vec<SymbolUnit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolUnit {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageDefinition {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub pads: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevicePin {
    pub id: String,
    pub number: String,
    pub name: String,
    pub group: String,
    pub electrical_type: PinElectricalType,
    pub direction: PinDirection,
    #[serde(default)]
    pub voltage_domain_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PinDirection {
    Input,
    Output,
    Bidirectional,
    Passive,
    Power,
    NotConnected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoltageDomain {
    pub id: String,
    pub name: String,
    pub min_voltage: f64,
    pub max_voltage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlternateFunction {
    pub pin_id: String,
    pub functions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DifferentialPair {
    pub id: String,
    pub positive_pin_id: String,
    pub negative_pin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceRuleKind {
    Required,
    AllowFloating,
    PowerInput,
    PowerOutput,
    BootConfiguration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceRule {
    pub id: String,
    pub kind: DeviceRuleKind,
    pub pin_ids: Vec<String>,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceModelKind {
    Spice,
    Ibis,
    SParameter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceModel {
    pub id: String,
    pub kind: DeviceModelKind,
    pub format: String,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub embedded_content: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SdkAdapterMetadata {
    pub id: String,
    pub sdk_type: String,
    pub version_requirement: String,
    #[serde(default)]
    pub local_path_patterns: Vec<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentMetadata {
    pub kind: String,
    pub title: String,
    pub source_url: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub license: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedDevicePack {
    pub sha256: String,
    pub pack: DevicePack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevicePackCapability {
    pub level: u8,
    pub code: String,
    pub available: bool,
}

#[derive(Debug, Error)]
pub enum DevicePackError {
    #[error("device pack path must use .devicepack.json or .sugeda-pack.json")]
    Extension,
    #[error("device pack is larger than 8 MiB")]
    TooLarge,
    #[error("cannot read device pack: {0}")]
    Read(#[from] std::io::Error),
    #[error("device pack JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported device pack format version {0}; this app supports version {DEVICE_PACK_FORMAT_VERSION}")]
    FormatVersion(u32),
    #[error("device pack validation [{code}]: {message}")]
    Invalid { code: &'static str, message: String },
    #[error("unsafe device pack content: {0}")]
    Unsafe(String),
}

fn invalid(code: &'static str, message: impl Into<String>) -> DevicePackError {
    DevicePackError::Invalid {
        code,
        message: message.into(),
    }
}

pub fn import(path: &Path) -> Result<EmbeddedDevicePack, DevicePackError> {
    let file_name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
    if !(file_name.ends_with(".devicepack.json") || file_name.ends_with(".sugeda-pack.json")) {
        return Err(DevicePackError::Extension);
    }
    if fs::metadata(path)?.len() > MAX_PACK_BYTES {
        return Err(DevicePackError::TooLarge);
    }
    let bytes = fs::read(path)?;
    import_bytes(&bytes)
}

pub fn import_bytes(bytes: &[u8]) -> Result<EmbeddedDevicePack, DevicePackError> {
    if bytes.len() as u64 > MAX_PACK_BYTES {
        return Err(DevicePackError::TooLarge);
    }
    let pack: DevicePack = serde_json::from_slice(bytes)?;
    validate(&pack)?;
    let canonical =
        serde_json::to_vec(&pack).expect("serializing a validated device pack cannot fail");
    Ok(EmbeddedDevicePack {
        sha256: format!("{:x}", Sha256::digest(canonical)),
        pack,
    })
}

pub fn content_hash(pack: &DevicePack) -> String {
    let canonical = serde_json::to_vec(pack).expect("serializing a device pack cannot fail");
    format!("{:x}", Sha256::digest(canonical))
}

fn text(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_STRING && !value.contains(['\0', '\r', '\n'])
}

fn id(value: &str) -> bool {
    text(value)
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '+'))
}

fn unique<'a>(values: impl IntoIterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

pub fn validate(pack: &DevicePack) -> Result<(), DevicePackError> {
    if pack.manifest.format_version != DEVICE_PACK_FORMAT_VERSION {
        return Err(DevicePackError::FormatVersion(pack.manifest.format_version));
    }
    for (label, value) in [
        ("manifest.id", pack.manifest.id.as_str()),
        ("manifest.name", &pack.manifest.name),
        ("manifest.vendor", &pack.manifest.vendor),
        ("manifest.version", &pack.manifest.version),
        ("manifest.source", &pack.manifest.source),
        ("manifest.license", &pack.manifest.license),
    ] {
        if !text(value) {
            return Err(invalid(
                "invalid_string",
                format!("{label} is empty, too long, or contains a control character"),
            ));
        }
    }
    if !id(&pack.manifest.id) {
        return Err(invalid(
            "invalid_id",
            "manifest.id is not a portable identifier",
        ));
    }
    if !pack.manifest.description.is_empty() && !text(&pack.manifest.description) {
        return Err(invalid(
            "invalid_string",
            "manifest.description is too long or contains a control character",
        ));
    }
    if pack.devices.is_empty() || pack.devices.len() > MAX_DEVICES {
        return Err(invalid(
            "device_count",
            format!("device count must be 1..={MAX_DEVICES}"),
        ));
    }
    if pack.models.len() > MAX_MODELS {
        return Err(invalid(
            "model_count",
            format!("model count exceeds {MAX_MODELS}"),
        ));
    }
    if pack.symbols.len() > MAX_DEVICES
        || pack.packages.len() > MAX_DEVICES
        || pack.sdk_adapters.len() > 512
        || pack.documents.len() > 512
    {
        return Err(invalid(
            "collection_count",
            "a top-level collection exceeds its defensive limit",
        ));
    }
    if !unique(pack.devices.iter().map(|v| v.id.as_str()))
        || !unique(pack.symbols.iter().map(|v| v.id.as_str()))
        || !unique(pack.packages.iter().map(|v| v.id.as_str()))
        || !unique(pack.models.iter().map(|v| v.id.as_str()))
        || !unique(pack.sdk_adapters.iter().map(|v| v.id.as_str()))
    {
        return Err(invalid(
            "duplicate_id",
            "IDs must be unique within each device-pack collection",
        ));
    }
    let symbols: BTreeSet<_> = pack.symbols.iter().map(|v| v.id.as_str()).collect();
    let packages: BTreeMap<_, _> = pack.packages.iter().map(|v| (v.id.as_str(), v)).collect();
    let models: BTreeSet<_> = pack.models.iter().map(|v| v.id.as_str()).collect();
    let adapters: BTreeSet<_> = pack.sdk_adapters.iter().map(|v| v.id.as_str()).collect();
    let mut total_pins = 0;
    for package in &pack.packages {
        if !id(&package.id)
            || !text(&package.name)
            || !text(&package.kind)
            || package.pads.len() > MAX_PINS_PER_DEVICE
            || !unique(package.pads.iter().map(String::as_str))
            || package.pads.iter().any(|v| !id(v))
        {
            return Err(invalid(
                "invalid_package",
                format!("package '{}' has invalid or duplicate pads", package.id),
            ));
        }
    }
    for symbol in &pack.symbols {
        if !id(&symbol.id)
            || !text(&symbol.name)
            || symbol.units.len() > 64
            || !unique(symbol.units.iter().map(|v| v.id.as_str()))
        {
            return Err(invalid(
                "invalid_symbol",
                format!("symbol '{}' is invalid", symbol.id),
            ));
        }
        for unit in &symbol.units {
            if !id(&unit.id)
                || !text(&unit.name)
                || unit.groups.len() > 128
                || unit.groups.iter().any(|v| !text(v))
            {
                return Err(invalid(
                    "invalid_symbol_unit",
                    format!("symbol unit '{}' is invalid", unit.id),
                ));
            }
        }
    }
    for device in &pack.devices {
        total_pins += device.pins.len();
        if !id(&device.id)
            || !text(&device.name)
            || !text(&device.device_type)
            || device.pins.is_empty()
            || device.pins.len() > MAX_PINS_PER_DEVICE
        {
            return Err(invalid(
                "invalid_device",
                format!("device '{}' is invalid", device.id),
            ));
        }
        if !symbols.contains(device.symbol_id.as_str())
            || !packages.contains_key(device.package_id.as_str())
        {
            return Err(invalid(
                "missing_reference",
                format!(
                    "device '{}' references a missing symbol or package",
                    device.id
                ),
            ));
        }
        if !unique(device.pins.iter().map(|v| v.id.as_str()))
            || !unique(device.pins.iter().map(|v| v.number.as_str()))
        {
            return Err(invalid(
                "duplicate_pin",
                format!("device '{}' has duplicate pin IDs or numbers", device.id),
            ));
        }
        let pin_ids: BTreeSet<_> = device.pins.iter().map(|v| v.id.as_str()).collect();
        if !unique(device.variants.iter().map(|v| v.id.as_str()))
            || device.variants.iter().any(|variant| {
                !id(&variant.id)
                    || !text(&variant.name)
                    || variant
                        .package_id
                        .as_deref()
                        .is_some_and(|package| !packages.contains_key(package))
            })
        {
            return Err(invalid(
                "invalid_variant",
                format!("device '{}' has an invalid variant", device.id),
            ));
        }
        let domains: BTreeMap<_, _> = device
            .voltage_domains
            .iter()
            .map(|v| (v.id.as_str(), v))
            .collect();
        if domains.len() != device.voltage_domains.len() {
            return Err(invalid(
                "duplicate_domain",
                format!("device '{}' has duplicate voltage-domain IDs", device.id),
            ));
        }
        for domain in &device.voltage_domains {
            if !id(&domain.id)
                || !text(&domain.name)
                || !domain.min_voltage.is_finite()
                || !domain.max_voltage.is_finite()
                || domain.min_voltage < 0.0
                || domain.max_voltage < domain.min_voltage
                || domain.max_voltage > 100_000.0
            {
                return Err(invalid(
                    "invalid_voltage_domain",
                    format!("voltage domain '{}' is invalid", domain.id),
                ));
            }
        }
        let package = packages[device.package_id.as_str()];
        for pin in &device.pins {
            if !id(&pin.id)
                || !id(&pin.number)
                || !text(&pin.name)
                || !text(&pin.group)
                || !package.pads.iter().any(|pad| pad == &pin.number)
                || pin
                    .voltage_domain_id
                    .as_deref()
                    .is_some_and(|domain| !domains.contains_key(domain))
            {
                return Err(invalid(
                    "invalid_pin",
                    format!(
                        "pin '{}' on '{}' is invalid or has an unresolved pad/domain",
                        pin.id, device.id
                    ),
                ));
            }
        }
        for function in &device.alternate_functions {
            if !pin_ids.contains(function.pin_id.as_str())
                || function.functions.is_empty()
                || function.functions.len() > 64
                || function.functions.iter().any(|v| !text(v))
            {
                return Err(invalid(
                    "invalid_alternate_function",
                    format!("alternate function for '{}' is invalid", function.pin_id),
                ));
            }
        }
        for pair in &device.differential_pairs {
            if !id(&pair.id)
                || pair.positive_pin_id == pair.negative_pin_id
                || !pin_ids.contains(pair.positive_pin_id.as_str())
                || !pin_ids.contains(pair.negative_pin_id.as_str())
            {
                return Err(invalid(
                    "invalid_differential_pair",
                    format!("differential pair '{}' is invalid", pair.id),
                ));
            }
        }
        if !unique(
            device
                .differential_pairs
                .iter()
                .map(|pair| pair.id.as_str()),
        ) {
            return Err(invalid(
                "duplicate_differential_pair",
                format!("device '{}' has duplicate differential-pair IDs", device.id),
            ));
        }
        if !unique(device.rules.iter().map(|rule| rule.id.as_str())) {
            return Err(invalid(
                "duplicate_rule",
                format!("device '{}' has duplicate rule IDs", device.id),
            ));
        }
        for rule in &device.rules {
            if !id(&rule.id)
                || rule.pin_ids.is_empty()
                || rule
                    .pin_ids
                    .iter()
                    .any(|pin| !pin_ids.contains(pin.as_str()))
                || !unique(rule.pin_ids.iter().map(String::as_str))
            {
                return Err(invalid(
                    "invalid_rule",
                    format!("rule '{}' has invalid pins", rule.id),
                ));
            }
            if !rule.message.is_empty() && !text(&rule.message) {
                return Err(invalid(
                    "invalid_rule",
                    format!("rule '{}' message is too long", rule.id),
                ));
            }
        }
        if device
            .model_ids
            .iter()
            .any(|v| !models.contains(v.as_str()))
            || device
                .sdk_adapter_ids
                .iter()
                .any(|v| !adapters.contains(v.as_str()))
        {
            return Err(invalid(
                "missing_reference",
                format!(
                    "device '{}' references a missing model or SDK adapter",
                    device.id
                ),
            ));
        }
    }
    if total_pins > MAX_TOTAL_PINS {
        return Err(invalid(
            "total_pin_count",
            format!("total pin count exceeds {MAX_TOTAL_PINS}"),
        ));
    }
    for model in &pack.models {
        if !id(&model.id)
            || !text(&model.format)
            || model.metadata.len() > 64
            || model.metadata.iter().any(|(k, v)| !text(k) || !text(v))
        {
            return Err(invalid(
                "invalid_model",
                format!("model '{}' metadata is invalid", model.id),
            ));
        }
        match model.kind {
            DeviceModelKind::Spice => {
                let content = model.embedded_content.as_deref().ok_or_else(|| {
                    invalid(
                        "external_model_reference",
                        format!("SPICE model '{}' must be embedded", model.id),
                    )
                })?;
                let inspected = crate::models::inspect(content)
                    .map_err(|e| DevicePackError::Unsafe(e.to_string()))?;
                let name = model.model_name.as_deref().ok_or_else(|| {
                    invalid(
                        "invalid_model",
                        format!("SPICE model '{}' needs modelName", model.id),
                    )
                })?;
                if !id(name) {
                    return Err(invalid(
                        "invalid_model",
                        format!("SPICE model '{}' has an invalid modelName", model.id),
                    ));
                }
                if !inspected.iter().any(|v| v.name.eq_ignore_ascii_case(name)) {
                    return Err(invalid(
                        "invalid_model",
                        format!(
                            "SPICE modelName '{}' is not exported by model '{}'",
                            name, model.id
                        ),
                    ));
                }
                if model
                    .sha256
                    .as_deref()
                    .is_some_and(|hash| hash != format!("{:x}", Sha256::digest(content.as_bytes())))
                {
                    return Err(invalid(
                        "model_hash",
                        format!("model '{}' checksum does not match", model.id),
                    ));
                }
            }
            DeviceModelKind::Ibis | DeviceModelKind::SParameter => {
                if model.embedded_content.is_some() {
                    return Err(invalid(
                        "unsupported_model_payload",
                        format!(
                            "{} payloads are metadata-only in this release",
                            model.format
                        ),
                    ));
                }
            }
        }
        if model
            .sha256
            .as_deref()
            .is_some_and(|hash| hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(invalid(
                "model_hash",
                format!("model '{}' has an invalid SHA-256 value", model.id),
            ));
        }
    }
    for adapter in &pack.sdk_adapters {
        if !id(&adapter.id)
            || !text(&adapter.sdk_type)
            || !text(&adapter.version_requirement)
            || adapter.local_path_patterns.len() > 32
            || adapter.local_path_patterns.iter().any(|v| {
                !text(v) || v.contains("..") || v.starts_with(['/', '\\']) || v.contains(['`', '$'])
            })
        {
            return Err(DevicePackError::Unsafe(format!(
                "SDK adapter '{}' contains an unsafe local path pattern",
                adapter.id
            )));
        }
    }
    for document in &pack.documents {
        if !text(&document.kind)
            || !text(&document.title)
            || document.source_url.len() > MAX_DOCUMENT_URL
            || !(document.source_url.starts_with("https://")
                || document.source_url.starts_with("http://"))
        {
            return Err(invalid(
                "invalid_document",
                "documents require an http(s) source URL",
            ));
        }
        if (!document.revision.is_empty() && !text(&document.revision))
            || (!document.license.is_empty() && !text(&document.license))
        {
            return Err(invalid(
                "invalid_document",
                "document revision or license is invalid",
            ));
        }
    }
    Ok(())
}

pub fn capabilities(pack: &DevicePack, device: &DeviceDefinition) -> Vec<DevicePackCapability> {
    let device_models: Vec<_> = pack
        .models
        .iter()
        .filter(|m| device.model_ids.contains(&m.id))
        .collect();
    vec![
        DevicePackCapability {
            level: 1,
            code: "schematic".into(),
            available: true,
        },
        DevicePackCapability {
            level: 2,
            code: "erc".into(),
            available: !device.rules.is_empty()
                || device
                    .pins
                    .iter()
                    .any(|p| p.electrical_type != PinElectricalType::Passive),
        },
        DevicePackCapability {
            level: 3,
            code: "spice".into(),
            available: device_models
                .iter()
                .any(|m| m.kind == DeviceModelKind::Spice),
        },
        DevicePackCapability {
            level: 4,
            code: "signalIntegrityMetadata".into(),
            available: device_models
                .iter()
                .any(|m| matches!(m.kind, DeviceModelKind::Ibis | DeviceModelKind::SParameter)),
        },
        DevicePackCapability {
            level: 5,
            code: "sdkAdapterMetadata".into(),
            available: !device.sdk_adapter_ids.is_empty(),
        },
        DevicePackCapability {
            level: 6,
            code: "firmwareSimulation".into(),
            available: false,
        },
    ]
}

pub fn embedded_spice_libraries(
    embedded: &EmbeddedDevicePack,
) -> Result<Vec<SpiceLibrary>, DevicePackError> {
    let mut result = vec![];
    for model in embedded
        .pack
        .models
        .iter()
        .filter(|m| m.kind == DeviceModelKind::Spice)
    {
        let content = model
            .embedded_content
            .as_ref()
            .expect("validated SPICE model content")
            .clone();
        result.push(SpiceLibrary {
            id: Uuid::new_v4(),
            name: format!("{} · {}", embedded.pack.manifest.name, model.id),
            source_name: format!("devicepack:{}:{}", embedded.sha256, model.id),
            sha256: format!("{:x}", Sha256::digest(content.as_bytes())),
            models: crate::models::inspect(&content)
                .map_err(|e| DevicePackError::Unsafe(e.to_string()))?,
            content,
        });
    }
    Ok(result)
}

pub fn instantiate(
    project: &Project,
    pack_hash: &str,
    device_id: &str,
    variant_id: Option<&str>,
    unit_id: Option<&str>,
    position: Point,
) -> Result<crate::domain::Component, String> {
    let embedded = project
        .device_packs
        .iter()
        .find(|v| v.sha256 == pack_hash)
        .ok_or_else(|| "Device pack is not embedded in this project".to_owned())?;
    let device = embedded
        .pack
        .devices
        .iter()
        .find(|v| v.id == device_id)
        .ok_or_else(|| format!("Device '{device_id}' is unavailable"))?;
    if variant_id.is_some_and(|id| !device.variants.iter().any(|v| v.id == id)) {
        return Err(format!(
            "Variant '{}' is unavailable",
            variant_id.unwrap_or_default()
        ));
    }
    let symbol = embedded
        .pack
        .symbols
        .iter()
        .find(|v| v.id == device.symbol_id)
        .ok_or_else(|| "Device symbol is unavailable".to_owned())?;
    let unit = unit_id
        .and_then(|id| symbol.units.iter().find(|v| v.id == id))
        .or_else(|| symbol.units.first());
    if unit_id.is_some() && unit.is_none() {
        return Err(format!(
            "Symbol unit '{}' is unavailable",
            unit_id.unwrap_or_default()
        ));
    }
    let included: Vec<_> = device
        .pins
        .iter()
        .filter(|pin| unit.is_none_or(|u| u.groups.is_empty() || u.groups.contains(&pin.group)))
        .collect();
    if included.is_empty() {
        return Err("Selected symbol unit contains no pins".into());
    }
    let left: Vec<_> = included
        .iter()
        .enumerate()
        .filter(|(index, pin)| {
            matches!(pin.direction, PinDirection::Input | PinDirection::Power)
                || (*index % 2 == 0
                    && matches!(
                        pin.direction,
                        PinDirection::Passive | PinDirection::Bidirectional
                    ))
        })
        .map(|(_, pin)| *pin)
        .collect();
    let left_ids: BTreeSet<_> = left.iter().map(|p| p.id.as_str()).collect();
    let right: Vec<_> = included
        .iter()
        .filter(|pin| !left_ids.contains(pin.id.as_str()))
        .copied()
        .collect();
    let rows = left.len().max(right.len()).max(2);
    let half_width = if included.len() > 40 { 150.0 } else { 110.0 };
    let pin_offset = |index: usize, count: usize, x: f64| Point {
        x,
        y: (index as f64 - (count.saturating_sub(1)) as f64 / 2.0) * 20.0,
    };
    let rules_for = |pin_id: &str| {
        device
            .rules
            .iter()
            .filter(|r| r.pin_ids.iter().any(|id| id == pin_id))
            .collect::<Vec<_>>()
    };
    let pair_for = |pin_id: &str| {
        device
            .differential_pairs
            .iter()
            .find(|pair| pair.positive_pin_id == pin_id || pair.negative_pin_id == pin_id)
    };
    let make_pin = |source: &DevicePin, offset: Point| {
        let domain = source
            .voltage_domain_id
            .as_deref()
            .and_then(|id| device.voltage_domains.iter().find(|v| v.id == id));
        let pin_rules = rules_for(&source.id);
        let pair = pair_for(&source.id);
        Pin {
            id: source.id.clone(),
            name: source.name.clone(),
            number: Some(source.number.clone()),
            group: Some(source.group.clone()),
            electrical_type: Some(source.electrical_type.clone()),
            direction: Some(format!("{:?}", source.direction).to_ascii_lowercase()),
            voltage_domain_id: source.voltage_domain_id.clone(),
            voltage_min: domain.map(|v| v.min_voltage),
            voltage_max: domain.map(|v| v.max_voltage),
            alternate_functions: device
                .alternate_functions
                .iter()
                .find(|v| v.pin_id == source.id)
                .map(|v| v.functions.clone())
                .unwrap_or_default(),
            differential_pair_id: pair.map(|v| v.id.clone()),
            differential_polarity: pair.map(|v| {
                if v.positive_pin_id == source.id {
                    "positive".into()
                } else {
                    "negative".into()
                }
            }),
            required: pin_rules.iter().any(|r| {
                matches!(
                    r.kind,
                    DeviceRuleKind::Required | DeviceRuleKind::PowerInput
                )
            }),
            allow_floating: pin_rules
                .iter()
                .any(|r| r.kind == DeviceRuleKind::AllowFloating)
                || source.direction == PinDirection::NotConnected,
            no_connect: false,
            offset,
        }
    };
    // Keep pack pin order stable for model-port mapping while laying the two sides out independently.
    let left_positions: BTreeMap<_, _> = left
        .iter()
        .enumerate()
        .map(|(index, pin)| (pin.id.as_str(), pin_offset(index, left.len(), -half_width)))
        .collect();
    let right_positions: BTreeMap<_, _> = right
        .iter()
        .enumerate()
        .map(|(index, pin)| (pin.id.as_str(), pin_offset(index, right.len(), half_width)))
        .collect();
    let pins = included
        .iter()
        .map(|pin| {
            make_pin(
                pin,
                left_positions
                    .get(pin.id.as_str())
                    .or_else(|| right_positions.get(pin.id.as_str()))
                    .copied()
                    .expect("included pin has a layout"),
            )
        })
        .collect();
    let model = device
        .model_ids
        .iter()
        .filter_map(|id| embedded.pack.models.iter().find(|m| &m.id == id))
        .find(|m| m.kind == DeviceModelKind::Spice)
        .and_then(|m| {
            let expected_hash = format!(
                "{:x}",
                Sha256::digest(m.embedded_content.as_deref()?.as_bytes())
            );
            let library = project
                .spice_libraries
                .iter()
                .find(|l| l.sha256 == expected_hash)?;
            let definition = library
                .models
                .iter()
                .find(|d| Some(d.name.as_str()) == m.model_name.as_deref())?;
            Some(ModelBinding {
                library_id: library.id,
                model_name: definition.name.clone(),
                kind: definition.kind.clone(),
            })
        });
    let prefix = if model.is_some() { "X" } else { "U" };
    let mut sequence = 1;
    while project.sheets[0].components.iter().any(|c| {
        c.spice_ref
            .eq_ignore_ascii_case(&format!("{prefix}{sequence}"))
    }) {
        sequence += 1;
    }
    Ok(crate::domain::Component {
        id: Uuid::new_v4(),
        kind: crate::domain::ComponentKind::Device,
        position,
        rotation: 0,
        parameters: BTreeMap::new(),
        pins,
        display_name: device.name.clone(),
        spice_ref: format!("{prefix}{sequence}"),
        model,
        device: Some(DeviceBinding {
            pack_sha256: embedded.sha256.clone(),
            pack_id: embedded.pack.manifest.id.clone(),
            pack_version: embedded.pack.manifest.version.clone(),
            device_id: device.id.clone(),
            variant_id: variant_id.map(str::to_owned),
            symbol_unit_id: unit.map(|u| u.id.clone()),
            capabilities: capabilities(&embedded.pack, device),
        }),
        symbol_width: Some(half_width * 2.0),
        symbol_height: Some(rows as f64 * 20.0 + 36.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_path_traversal_and_external_spice_models() {
        let fixture = include_bytes!("../../examples/devicepacks/test-mcu.devicepack.json");
        let mut pack: DevicePack = serde_json::from_slice(fixture).unwrap();
        pack.sdk_adapters[0].local_path_patterns = vec!["../../secret".into()];
        assert!(matches!(validate(&pack), Err(DevicePackError::Unsafe(_))));
        pack.sdk_adapters[0].local_path_patterns = vec!["sdk/*".into()];
        pack.models.push(DeviceModel {
            id: "external".into(),
            kind: DeviceModelKind::Spice,
            format: "spice-subcircuit".into(),
            model_name: Some("X".into()),
            embedded_content: None,
            sha256: None,
            metadata: BTreeMap::new(),
        });
        assert!(validate(&pack).is_err());
    }

    #[test]
    fn accepts_all_self_contained_test_packs() {
        for bytes in [
            include_bytes!("../../examples/devicepacks/test-analog.devicepack.json").as_slice(),
            include_bytes!("../../examples/devicepacks/test-mcu.devicepack.json").as_slice(),
            include_bytes!("../../examples/devicepacks/test-soc.devicepack.json").as_slice(),
        ] {
            assert!(import_bytes(bytes).is_ok());
        }
    }

    #[test]
    fn large_bga_pack_validation_and_unit_instantiation_stay_bounded() {
        let started = std::time::Instant::now();
        let embedded = import_bytes(include_bytes!(
            "../../examples/devicepacks/test-soc.devicepack.json"
        ))
        .unwrap();
        assert_eq!(embedded.pack.devices[0].pins.len(), 144);
        let mut project = Project::blank("large device");
        project.device_packs.push(embedded.clone());
        for unit in ["power", "core", "ddr", "gpio", "usb", "pcie"] {
            let component = instantiate(
                &project,
                &embedded.sha256,
                "stsoc144",
                Some("base"),
                Some(unit),
                Point { x: 0.0, y: 0.0 },
            )
            .unwrap();
            assert_eq!(component.pins.len(), 24);
            assert!(component.symbol_height.unwrap_or_default() <= 520.0);
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }
}
