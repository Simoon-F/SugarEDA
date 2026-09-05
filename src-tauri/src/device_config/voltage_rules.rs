use super::{diagnostic::domain_issue, DeviceConfig, DeviceConfigIssue};
use crate::device_pack::DeviceDefinition;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn check(
    config: &DeviceConfig,
    device: &DeviceDefinition,
    issues: &mut Vec<DeviceConfigIssue>,
) {
    let domains = device
        .voltage_domains
        .iter()
        .map(|domain| (domain.id.as_str(), domain))
        .collect::<BTreeMap<_, _>>();
    let mut selected = BTreeSet::new();
    for selection in &config.voltage_selections {
        if !selected.insert(selection.domain_id.as_str()) {
            issues.push(domain_issue(
                "device-config.duplicate-voltage-selection",
                &selection.domain_id,
                format!("电压域 {} 被重复选择", selection.domain_id),
                format!(
                    "Voltage domain {} has more than one selection",
                    selection.domain_id
                ),
            ));
            continue;
        }
        let Some(domain) = domains.get(selection.domain_id.as_str()) else {
            issues.push(domain_issue(
                "device-config.unknown-voltage-domain",
                &selection.domain_id,
                format!("器件中不存在电压域 {}", selection.domain_id),
                format!(
                    "Voltage domain {} does not exist on the device",
                    selection.domain_id
                ),
            ));
            continue;
        };
        if selection.voltage < domain.min_voltage || selection.voltage > domain.max_voltage {
            issues.push(domain_issue(
                "device-config.voltage-out-of-range",
                &selection.domain_id,
                format!(
                    "电压域 {} 选择的 {} V 超出允许范围 {}–{} V",
                    selection.domain_id, selection.voltage, domain.min_voltage, domain.max_voltage
                ),
                format!(
                    "Selected {} V for domain {} is outside the allowed {}–{} V range",
                    selection.voltage, selection.domain_id, domain.min_voltage, domain.max_voltage
                ),
            ));
        }
    }
}
