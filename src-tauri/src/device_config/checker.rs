use super::format::DeviceConfig;
use crate::device_pack::{DeviceDefinition, DeviceRuleKind, EmbeddedDevicePack};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigReport {
    pub valid: bool,
    pub format_version: u32,
    pub config_id: String,
    pub config_name: String,
    pub pack_sha256: String,
    pub device_id: String,
    pub checked_assignments: usize,
    pub issues: Vec<DeviceConfigIssue>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigIssue {
    pub code: &'static str,
    pub severity: &'static str,
    pub pin_id: Option<String>,
    pub message_zh: String,
    pub message_en: String,
}

pub(super) fn check(
    config: &DeviceConfig,
    embedded: &EmbeddedDevicePack,
    device: &DeviceDefinition,
) -> DeviceConfigReport {
    let mut issues = Vec::new();
    let target_pack_matches = config.target.pack_id == embedded.pack.manifest.id;
    let target_device_matches = config.target.device_id == device.id;
    check_target(config, embedded, device, &mut issues);
    if target_pack_matches && target_device_matches {
        check_pin_mux(config, device, &mut issues);
        check_boot_straps(config, device, &mut issues);
    }
    DeviceConfigReport {
        valid: !issues.iter().any(|issue| issue.severity == "error"),
        format_version: config.format_version,
        config_id: config.id.clone(),
        config_name: config.name.clone(),
        pack_sha256: embedded.sha256.clone(),
        device_id: device.id.clone(),
        checked_assignments: config.pin_mux.len() + config.boot_straps.len(),
        issues,
    }
}

fn check_target(
    config: &DeviceConfig,
    embedded: &EmbeddedDevicePack,
    device: &DeviceDefinition,
    issues: &mut Vec<DeviceConfigIssue>,
) {
    if config.target.pack_id != embedded.pack.manifest.id {
        issues.push(issue(
            "device-config.target-pack-mismatch",
            None,
            format!(
                "配置目标器件包为 {}，当前选择为 {}",
                config.target.pack_id, embedded.pack.manifest.id
            ),
            format!(
                "Configuration targets pack {}, but {} is selected",
                config.target.pack_id, embedded.pack.manifest.id
            ),
        ));
    }
    if config.target.pack_version != embedded.pack.manifest.version {
        issues.push(issue(
            "device-config.target-version-mismatch",
            None,
            format!(
                "配置目标器件包版本为 {}，当前嵌入版本为 {}",
                config.target.pack_version, embedded.pack.manifest.version
            ),
            format!(
                "Configuration targets pack version {}, but embedded version is {}",
                config.target.pack_version, embedded.pack.manifest.version
            ),
        ));
    }
    if config.target.device_id != device.id {
        issues.push(issue(
            "device-config.target-device-mismatch",
            None,
            format!(
                "配置目标器件为 {}，当前选择为 {}",
                config.target.device_id, device.id
            ),
            format!(
                "Configuration targets device {}, but {} is selected",
                config.target.device_id, device.id
            ),
        ));
    }
    if let Some(variant_id) = &config.target.variant_id {
        if !device
            .variants
            .iter()
            .any(|variant| variant.id == *variant_id)
        {
            issues.push(issue(
                "device-config.unknown-variant",
                None,
                format!("器件不包含配置指定的变体 {variant_id}"),
                format!("Device does not contain configured variant {variant_id}"),
            ));
        }
    }
}

fn check_pin_mux(
    config: &DeviceConfig,
    device: &DeviceDefinition,
    issues: &mut Vec<DeviceConfigIssue>,
) {
    let pins = device
        .pins
        .iter()
        .map(|pin| pin.id.as_str())
        .collect::<BTreeSet<_>>();
    let alternate_functions = device
        .alternate_functions
        .iter()
        .map(|alternate| (alternate.pin_id.as_str(), &alternate.functions))
        .collect::<BTreeMap<_, _>>();
    let mut assigned_pins = BTreeSet::new();
    let mut assigned_functions: BTreeMap<&str, &str> = BTreeMap::new();

    for assignment in &config.pin_mux {
        if !assigned_pins.insert(assignment.pin_id.as_str()) {
            issues.push(issue(
                "device-config.duplicate-pin-assignment",
                Some(&assignment.pin_id),
                format!("引脚 {} 被重复分配 PinMux 功能", assignment.pin_id),
                format!(
                    "Pin {} has more than one PinMux assignment",
                    assignment.pin_id
                ),
            ));
            continue;
        }
        if !pins.contains(assignment.pin_id.as_str()) {
            issues.push(issue(
                "device-config.unknown-pin",
                Some(&assignment.pin_id),
                format!("器件中不存在引脚 {}", assignment.pin_id),
                format!("Pin {} does not exist on the device", assignment.pin_id),
            ));
            continue;
        }
        let supported = alternate_functions
            .get(assignment.pin_id.as_str())
            .is_some_and(|functions| functions.contains(&assignment.function));
        if !supported {
            issues.push(issue(
                "device-config.unsupported-function",
                Some(&assignment.pin_id),
                format!(
                    "引脚 {} 不支持复用功能 {}",
                    assignment.pin_id, assignment.function
                ),
                format!(
                    "Pin {} does not support alternate function {}",
                    assignment.pin_id, assignment.function
                ),
            ));
            continue;
        }
        if let Some(first_pin) =
            assigned_functions.insert(assignment.function.as_str(), assignment.pin_id.as_str())
        {
            if first_pin != assignment.pin_id && !is_repeatable_function(&assignment.function) {
                issues.push(issue(
                    "device-config.signal-conflict",
                    Some(&assignment.pin_id),
                    format!(
                        "复用信号 {} 同时分配给引脚 {} 和 {}",
                        assignment.function, first_pin, assignment.pin_id
                    ),
                    format!(
                        "Alternate signal {} is assigned to both {} and {}",
                        assignment.function, first_pin, assignment.pin_id
                    ),
                ));
            }
        }
    }
}

fn check_boot_straps(
    config: &DeviceConfig,
    device: &DeviceDefinition,
    issues: &mut Vec<DeviceConfigIssue>,
) {
    let pins = device
        .pins
        .iter()
        .map(|pin| pin.id.as_str())
        .collect::<BTreeSet<_>>();
    let required = device
        .rules
        .iter()
        .filter(|rule| rule.kind == DeviceRuleKind::BootConfiguration)
        .flat_map(|rule| rule.pin_ids.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    let pin_mux_pins = config
        .pin_mux
        .iter()
        .map(|assignment| assignment.pin_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut configured = BTreeSet::new();

    for strap in &config.boot_straps {
        if !configured.insert(strap.pin_id.as_str()) {
            issues.push(issue(
                "device-config.duplicate-boot-strap",
                Some(&strap.pin_id),
                format!("启动配置引脚 {} 被重复定义", strap.pin_id),
                format!("Boot strap pin {} is defined more than once", strap.pin_id),
            ));
            continue;
        }
        if !pins.contains(strap.pin_id.as_str()) {
            issues.push(issue(
                "device-config.unknown-boot-pin",
                Some(&strap.pin_id),
                format!("器件中不存在启动配置引脚 {}", strap.pin_id),
                format!(
                    "Boot strap pin {} does not exist on the device",
                    strap.pin_id
                ),
            ));
        }
        if pin_mux_pins.contains(strap.pin_id.as_str()) {
            issues.push(issue(
                "device-config.boot-pinmux-conflict",
                Some(&strap.pin_id),
                format!("引脚 {} 同时配置为 PinMux 和启动绑带", strap.pin_id),
                format!(
                    "Pin {} is configured as both PinMux and a boot strap",
                    strap.pin_id
                ),
            ));
        }
    }
    for pin_id in required.difference(&configured) {
        issues.push(issue(
            "device-config.boot-pin-unconfigured",
            Some(pin_id),
            format!("必需的启动配置引脚 {pin_id} 未定义状态"),
            format!("Required boot configuration pin {pin_id} has no defined state"),
        ));
    }
}

fn is_repeatable_function(function: &str) -> bool {
    matches!(function, "GPIO" | "ANALOG" | "NC")
}

fn issue(
    code: &'static str,
    pin_id: Option<&str>,
    message_zh: impl Into<String>,
    message_en: impl Into<String>,
) -> DeviceConfigIssue {
    DeviceConfigIssue {
        code,
        severity: "error",
        pin_id: pin_id.map(str::to_owned),
        message_zh: message_zh.into(),
        message_en: message_en.into(),
    }
}
