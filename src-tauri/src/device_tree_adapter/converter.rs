use super::{
    diagnostic::DeviceTreeDiagnostic,
    parser::{ParsedAssignment, ParsedDeviceTree, ParsedProperty},
};
use crate::device_config::{
    BootStrapAssignment, BootStrapValue, DeviceConfig, DeviceConfigTarget, PinMuxAssignment,
    VoltageSelection,
};
use serde::Serialize;
use std::collections::BTreeMap;

const ALLOWED_ROOT_PROPERTIES: &[&str] = &[
    "compatible",
    "config-id",
    "config-name",
    "source",
    "license",
    "pack-id",
    "pack-version",
    "device-id",
    "variant-id",
];

pub(super) struct ConvertedDeviceTree {
    pub config: DeviceConfig,
    pub locations: Vec<DeviceTreeSourceLocation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTreeSourceLocation {
    pub pin_id: Option<String>,
    pub domain_id: Option<String>,
    pub section: &'static str,
    pub line: usize,
    pub column: usize,
}

pub(super) fn convert(
    parsed: ParsedDeviceTree,
) -> Result<ConvertedDeviceTree, DeviceTreeDiagnostic> {
    reject_unknown_root_properties(&parsed.properties)?;
    let compatible = required(&parsed.properties, "compatible")?;
    if compatible.value != "sugareda,device-config-v1" {
        return Err(DeviceTreeDiagnostic::error(
            "device-tree.incompatible",
            Some(compatible.line),
            Some(compatible.column),
            "compatible 必须为 sugareda,device-config-v1",
            "compatible must be sugareda,device-config-v1",
        ));
    }

    let mut locations = Vec::with_capacity(
        parsed.pin_mux.len() + parsed.boot_straps.len() + parsed.voltage_selections.len(),
    );
    let pin_mux = parsed
        .pin_mux
        .iter()
        .map(|assignment| {
            let pin = assignment_property(assignment, "pin")?;
            let function = assignment_property(assignment, "function")?;
            locations.push(DeviceTreeSourceLocation {
                pin_id: Some(pin.value.clone()),
                domain_id: None,
                section: "pinMux",
                line: pin.line,
                column: pin.column,
            });
            Ok(PinMuxAssignment {
                pin_id: pin.value.clone(),
                function: function.value.clone(),
            })
        })
        .collect::<Result<Vec<_>, DeviceTreeDiagnostic>>()?;
    let voltage_selections = parsed
        .voltage_selections
        .iter()
        .map(|assignment| {
            let domain = assignment_property(assignment, "domain")?;
            let voltage_property = assignment_property(assignment, "voltage")?;
            let voltage = voltage_property.value.parse::<f64>().map_err(|_| {
                DeviceTreeDiagnostic::error(
                    "device-tree.invalid-voltage",
                    Some(voltage_property.line),
                    Some(voltage_property.column),
                    "voltage 必须是以伏特为单位的有限十进制数",
                    "voltage must be a finite decimal number expressed in volts",
                )
            })?;
            if !voltage.is_finite() {
                return Err(DeviceTreeDiagnostic::error(
                    "device-tree.invalid-voltage",
                    Some(voltage_property.line),
                    Some(voltage_property.column),
                    "voltage 必须是以伏特为单位的有限十进制数",
                    "voltage must be a finite decimal number expressed in volts",
                ));
            }
            locations.push(DeviceTreeSourceLocation {
                pin_id: None,
                domain_id: Some(domain.value.clone()),
                section: "voltageDomain",
                line: domain.line,
                column: domain.column,
            });
            Ok(VoltageSelection {
                domain_id: domain.value.clone(),
                voltage,
            })
        })
        .collect::<Result<Vec<_>, DeviceTreeDiagnostic>>()?;
    let boot_straps = parsed
        .boot_straps
        .iter()
        .map(|assignment| {
            let pin = assignment_property(assignment, "pin")?;
            let value = assignment_property(assignment, "value")?;
            locations.push(DeviceTreeSourceLocation {
                pin_id: Some(pin.value.clone()),
                domain_id: None,
                section: "bootStrap",
                line: pin.line,
                column: pin.column,
            });
            Ok(BootStrapAssignment {
                pin_id: pin.value.clone(),
                value: boot_value(value)?,
            })
        })
        .collect::<Result<Vec<_>, DeviceTreeDiagnostic>>()?;

    Ok(ConvertedDeviceTree {
        config: DeviceConfig {
            format_version: 1,
            id: required_value(&parsed.properties, "config-id")?,
            name: required_value(&parsed.properties, "config-name")?,
            source: required_value(&parsed.properties, "source")?,
            license: required_value(&parsed.properties, "license")?,
            target: DeviceConfigTarget {
                pack_id: required_value(&parsed.properties, "pack-id")?,
                pack_version: required_value(&parsed.properties, "pack-version")?,
                device_id: required_value(&parsed.properties, "device-id")?,
                variant_id: parsed
                    .properties
                    .get("variant-id")
                    .map(|property| property.value.clone()),
            },
            pin_mux,
            boot_straps,
            voltage_selections,
        },
        locations,
    })
}

fn reject_unknown_root_properties(
    properties: &BTreeMap<String, ParsedProperty>,
) -> Result<(), DeviceTreeDiagnostic> {
    if let Some((name, property)) = properties
        .iter()
        .find(|(name, _)| !ALLOWED_ROOT_PROPERTIES.contains(&name.as_str()))
    {
        return Err(DeviceTreeDiagnostic::error(
            "device-tree.unknown-property",
            Some(property.line),
            Some(property.column),
            format!("配置节点中不允许属性 {name}"),
            format!("Property {name} is not allowed in the configuration node"),
        ));
    }
    Ok(())
}

fn required_value(
    properties: &BTreeMap<String, ParsedProperty>,
    name: &'static str,
) -> Result<String, DeviceTreeDiagnostic> {
    Ok(required(properties, name)?.value.clone())
}

fn required<'a>(
    properties: &'a BTreeMap<String, ParsedProperty>,
    name: &'static str,
) -> Result<&'a ParsedProperty, DeviceTreeDiagnostic> {
    properties.get(name).ok_or_else(|| {
        DeviceTreeDiagnostic::error(
            "device-tree.missing-property",
            None,
            None,
            format!("缺少必需属性 {name}"),
            format!("Required property {name} is missing"),
        )
    })
}

fn assignment_property<'a>(
    assignment: &'a ParsedAssignment,
    name: &'static str,
) -> Result<&'a ParsedProperty, DeviceTreeDiagnostic> {
    assignment.properties.get(name).ok_or_else(|| {
        DeviceTreeDiagnostic::error(
            "device-tree.missing-assignment-property",
            Some(assignment.line),
            Some(assignment.column),
            format!("分配节点缺少属性 {name}"),
            format!("Assignment node is missing property {name}"),
        )
    })
}

fn boot_value(property: &ParsedProperty) -> Result<BootStrapValue, DeviceTreeDiagnostic> {
    match property.value.as_str() {
        "low" => Ok(BootStrapValue::Low),
        "high" => Ok(BootStrapValue::High),
        "pull-down" => Ok(BootStrapValue::PullDown),
        "pull-up" => Ok(BootStrapValue::PullUp),
        "external" => Ok(BootStrapValue::External),
        _ => Err(DeviceTreeDiagnostic::error(
            "device-tree.invalid-boot-value",
            Some(property.line),
            Some(property.column),
            "启动值只能是 low、high、pull-down、pull-up 或 external",
            "Boot value must be low, high, pull-down, pull-up, or external",
        )),
    }
}
