use super::{id, invalid, text, unique, DeviceDefinition, DevicePackError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MAX_CONFIGURATION_RULES: usize = 256;
const MAX_RULE_REFERENCES: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeviceConfigurationRule {
    RequiredFunctions {
        id: String,
        functions: Vec<String>,
        #[serde(default)]
        message: String,
    },
    CompleteFunctionGroup {
        id: String,
        functions: Vec<String>,
        #[serde(default)]
        message: String,
    },
    MutuallyExclusiveFunctions {
        id: String,
        functions: Vec<String>,
        #[serde(default)]
        message: String,
    },
    FunctionDependency {
        id: String,
        when_any: Vec<String>,
        require_all: Vec<String>,
        #[serde(default)]
        message: String,
    },
    RequiredVoltageDomains {
        id: String,
        voltage_domain_ids: Vec<String>,
        #[serde(default)]
        message: String,
    },
}

impl DeviceConfigurationRule {
    fn id(&self) -> &str {
        match self {
            Self::RequiredFunctions { id, .. }
            | Self::CompleteFunctionGroup { id, .. }
            | Self::MutuallyExclusiveFunctions { id, .. }
            | Self::FunctionDependency { id, .. }
            | Self::RequiredVoltageDomains { id, .. } => id,
        }
    }

    fn message(&self) -> &str {
        match self {
            Self::RequiredFunctions { message, .. }
            | Self::CompleteFunctionGroup { message, .. }
            | Self::MutuallyExclusiveFunctions { message, .. }
            | Self::FunctionDependency { message, .. }
            | Self::RequiredVoltageDomains { message, .. } => message,
        }
    }
}

pub(super) fn validate(device: &DeviceDefinition) -> Result<(), DevicePackError> {
    if device.configuration_rules.len() > MAX_CONFIGURATION_RULES
        || !unique(
            device
                .configuration_rules
                .iter()
                .map(DeviceConfigurationRule::id),
        )
    {
        return Err(invalid(
            "invalid_configuration_rule",
            format!(
                "device '{}' has too many or duplicate configuration rules",
                device.id
            ),
        ));
    }

    let function_names = device
        .alternate_functions
        .iter()
        .flat_map(|alternate| alternate.functions.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    let domain_ids = device
        .voltage_domains
        .iter()
        .map(|domain| domain.id.as_str())
        .collect::<BTreeSet<_>>();

    for rule in &device.configuration_rules {
        if !id(rule.id()) || (!rule.message().is_empty() && !text(rule.message())) {
            return Err(invalid(
                "invalid_configuration_rule",
                format!("configuration rule '{}' is invalid", rule.id()),
            ));
        }
        let valid_functions = |values: &[String]| {
            !values.is_empty()
                && values.len() <= MAX_RULE_REFERENCES
                && unique(values.iter().map(String::as_str))
                && values
                    .iter()
                    .all(|function| function_names.contains(function.as_str()))
        };
        let valid = match rule {
            DeviceConfigurationRule::RequiredFunctions { functions, .. }
            | DeviceConfigurationRule::CompleteFunctionGroup { functions, .. }
            | DeviceConfigurationRule::MutuallyExclusiveFunctions { functions, .. } => {
                valid_functions(functions)
            }
            DeviceConfigurationRule::FunctionDependency {
                when_any,
                require_all,
                ..
            } => valid_functions(when_any) && valid_functions(require_all),
            DeviceConfigurationRule::RequiredVoltageDomains {
                voltage_domain_ids, ..
            } => {
                !voltage_domain_ids.is_empty()
                    && voltage_domain_ids.len() <= MAX_RULE_REFERENCES
                    && unique(voltage_domain_ids.iter().map(String::as_str))
                    && voltage_domain_ids
                        .iter()
                        .all(|domain| domain_ids.contains(domain.as_str()))
            }
        };
        if !valid {
            return Err(invalid(
                "invalid_configuration_rule",
                format!(
                    "configuration rule '{}' references missing or duplicate functions/domains",
                    rule.id()
                ),
            ));
        }
    }
    Ok(())
}
