use super::{
    diagnostic::{pin_issue, DeviceConfigIssue, DeviceConfigReport},
    pack_rules, pin_rules, voltage_rules, DeviceConfig,
};
use crate::device_pack::{DeviceDefinition, EmbeddedDevicePack};

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
        pin_rules::check(config, device, &mut issues);
        voltage_rules::check(config, device, &mut issues);
        pack_rules::check(config, device, &mut issues);
    }
    DeviceConfigReport {
        valid: !issues.iter().any(|issue| issue.severity == "error"),
        format_version: config.format_version,
        config_id: config.id.clone(),
        config_name: config.name.clone(),
        pack_sha256: embedded.sha256.clone(),
        device_id: device.id.clone(),
        checked_assignments: config.pin_mux.len()
            + config.boot_straps.len()
            + config.voltage_selections.len(),
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
        issues.push(pin_issue(
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
        issues.push(pin_issue(
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
        issues.push(pin_issue(
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
            issues.push(pin_issue(
                "device-config.unknown-variant",
                None,
                format!("器件不包含配置指定的变体 {variant_id}"),
                format!("Device does not contain configured variant {variant_id}"),
            ));
        }
    }
}
