use super::{diagnostic::domain_issue, diagnostic::pin_issue, DeviceConfig, DeviceConfigIssue};
use crate::device_pack::{DeviceConfigurationRule, DeviceDefinition};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn check(
    config: &DeviceConfig,
    device: &DeviceDefinition,
    issues: &mut Vec<DeviceConfigIssue>,
) {
    let supported = device
        .alternate_functions
        .iter()
        .map(|alternate| (alternate.pin_id.as_str(), &alternate.functions))
        .collect::<BTreeMap<_, _>>();
    let assigned = config
        .pin_mux
        .iter()
        .filter(|assignment| {
            supported
                .get(assignment.pin_id.as_str())
                .is_some_and(|functions| functions.contains(&assignment.function))
        })
        .map(|assignment| assignment.function.as_str())
        .collect::<BTreeSet<_>>();
    let selected_domains = config
        .voltage_selections
        .iter()
        .map(|selection| selection.domain_id.as_str())
        .collect::<BTreeSet<_>>();

    for rule in &device.configuration_rules {
        match rule {
            DeviceConfigurationRule::RequiredFunctions { id, functions, .. } => {
                let missing = missing(functions, &assigned);
                if !missing.is_empty() {
                    issues.push(pin_issue(
                        "device-config.required-functions-missing",
                        None,
                        format!("配置规则 {id} 缺少必需功能：{}", missing.join("、")),
                        format!(
                            "Configuration rule {id} is missing required functions: {}",
                            missing.join(", ")
                        ),
                    ));
                }
            }
            DeviceConfigurationRule::CompleteFunctionGroup { id, functions, .. } => {
                let active = functions
                    .iter()
                    .any(|function| assigned.contains(function.as_str()));
                let missing = missing(functions, &assigned);
                if active && !missing.is_empty() {
                    issues.push(pin_issue(
                        "device-config.incomplete-function-group",
                        None,
                        format!("功能组 {id} 已启用但缺少：{}", missing.join("、")),
                        format!(
                            "Function group {id} is active but missing: {}",
                            missing.join(", ")
                        ),
                    ));
                }
            }
            DeviceConfigurationRule::MutuallyExclusiveFunctions { id, functions, .. } => {
                let selected = functions
                    .iter()
                    .filter(|function| assigned.contains(function.as_str()))
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                if selected.len() > 1 {
                    issues.push(pin_issue(
                        "device-config.mutually-exclusive-functions",
                        None,
                        format!("互斥规则 {id} 同时选择了：{}", selected.join("、")),
                        format!(
                            "Mutual-exclusion rule {id} selected together: {}",
                            selected.join(", ")
                        ),
                    ));
                }
            }
            DeviceConfigurationRule::FunctionDependency {
                id,
                when_any,
                require_all,
                ..
            } => {
                let active = when_any
                    .iter()
                    .any(|function| assigned.contains(function.as_str()));
                let missing = missing(require_all, &assigned);
                if active && !missing.is_empty() {
                    issues.push(pin_issue(
                        "device-config.function-dependency-unsatisfied",
                        None,
                        format!("功能依赖 {id} 缺少：{}", missing.join("、")),
                        format!(
                            "Function dependency {id} is missing: {}",
                            missing.join(", ")
                        ),
                    ));
                }
            }
            DeviceConfigurationRule::RequiredVoltageDomains {
                id,
                voltage_domain_ids,
                ..
            } => {
                let missing = voltage_domain_ids
                    .iter()
                    .filter(|domain| !selected_domains.contains(domain.as_str()))
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                if !missing.is_empty() {
                    issues.push(domain_issue(
                        "device-config.required-voltage-domain-missing",
                        missing[0],
                        format!("电压规则 {id} 缺少电压域选择：{}", missing.join("、")),
                        format!(
                            "Voltage rule {id} is missing domain selections: {}",
                            missing.join(", ")
                        ),
                    ));
                }
            }
        }
    }
}

fn missing<'a>(functions: &'a [String], assigned: &BTreeSet<&str>) -> Vec<&'a str> {
    functions
        .iter()
        .filter(|function| !assigned.contains(function.as_str()))
        .map(String::as_str)
        .collect()
}
