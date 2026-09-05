//! Resolves logical DevicePack instances into simulator-ready model ports.
//!
//! This is the boundary between persisted device metadata and netlist backends.
//! It never evaluates models and does not own electrical connectivity.

use crate::device_pack::{DeviceDefinition, DeviceModelKind, DevicePack};
use crate::domain::{Component, ModelBinding, Pin, Project, SchematicSheet};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingIssue {
    pub code: &'static str,
    pub message: String,
    pub component_id: Option<Uuid>,
}

pub struct MetadataIssue {
    pub code: &'static str,
    pub message: String,
}

pub fn validate_device_metadata(
    pack: &DevicePack,
    device: &DeviceDefinition,
) -> Result<(), MetadataIssue> {
    let binding_ids: BTreeSet<_> = device
        .spice_bindings
        .iter()
        .map(|binding| binding.model_id.as_str())
        .collect();
    if binding_ids.len() != device.spice_bindings.len() {
        return Err(metadata_issue(
            "duplicate_spice_binding",
            format!("device '{}' has duplicate SPICE bindings", device.id),
        ));
    }
    let pin_ids: BTreeSet<_> = device.pins.iter().map(|pin| pin.id.as_str()).collect();
    for binding in &device.spice_bindings {
        let model = pack
            .models
            .iter()
            .find(|model| model.id == binding.model_id)
            .filter(|model| model.kind == DeviceModelKind::Spice)
            .ok_or_else(|| {
                metadata_issue(
                    "invalid_spice_binding",
                    format!(
                        "SPICE binding '{}' on '{}' references a missing or non-SPICE model",
                        binding.model_id, device.id
                    ),
                )
            })?;
        if !device.model_ids.contains(&binding.model_id) {
            return Err(metadata_issue(
                "invalid_spice_binding",
                format!(
                    "SPICE binding '{}' is not enabled by device '{}'",
                    binding.model_id, device.id
                ),
            ));
        }
        let definition =
            crate::models::inspect(model.embedded_content.as_deref().ok_or_else(|| {
                metadata_issue("invalid_spice_binding", "SPICE content is missing")
            })?)
            .map_err(|error| metadata_issue("invalid_spice_binding", error.to_string()))?
            .into_iter()
            .find(|definition| {
                model
                    .model_name
                    .as_deref()
                    .is_some_and(|name| definition.name.eq_ignore_ascii_case(name))
            })
            .ok_or_else(|| {
                metadata_issue("invalid_spice_binding", "SPICE model is not exported")
            })?;
        let mapped_ports: BTreeMap<_, _> = binding
            .ports
            .iter()
            .map(|port| (port.model_port.to_ascii_lowercase(), port.pin_id.as_str()))
            .collect();
        let mapped_pins: BTreeSet<_> = binding
            .ports
            .iter()
            .map(|port| port.pin_id.as_str())
            .collect();
        if mapped_ports.len() != binding.ports.len()
            || mapped_pins.len() != binding.ports.len()
            || binding.ports.len() != definition.pins.len()
            || binding.ports.iter().any(|port| {
                !metadata_text(&port.model_port) || !pin_ids.contains(port.pin_id.as_str())
            })
            || definition
                .pins
                .iter()
                .any(|port| !mapped_ports.contains_key(&port.to_ascii_lowercase()))
        {
            return Err(metadata_issue(
                "invalid_spice_binding",
                format!(
                    "SPICE binding '{}' on '{}' must map every model port to one valid device pin",
                    binding.model_id, device.id
                ),
            ));
        }
    }
    let is_multi_unit = pack
        .symbols
        .iter()
        .find(|symbol| symbol.id == device.symbol_id)
        .is_some_and(|symbol| symbol.units.len() > 1);
    if is_multi_unit {
        for model_id in &device.model_ids {
            if pack
                .models
                .iter()
                .any(|model| model.id == *model_id && model.kind == DeviceModelKind::Spice)
                && !binding_ids.contains(model_id.as_str())
            {
                return Err(metadata_issue(
                    "missing_spice_binding",
                    format!(
                        "multi-unit device '{}' requires an explicit binding for SPICE model '{}'",
                        device.id, model_id
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn metadata_issue(code: &'static str, message: impl Into<String>) -> MetadataIssue {
    MetadataIssue {
        code,
        message: message.into(),
    }
}

fn metadata_text(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 512
        && !value.chars().any(|character| character.is_control())
}

pub struct BoundPin<'a> {
    pub component: &'a Component,
    pub pin: &'a Pin,
}

pub struct ResolvedDevice<'a> {
    pub reference: &'a str,
    pub model: &'a ModelBinding,
    /// Pins ordered exactly as declared by the SPICE model.
    pub pins: Vec<BoundPin<'a>>,
}

pub fn resolve<'a>(
    project: &'a Project,
    sheet: &'a SchematicSheet,
) -> Result<Vec<ResolvedDevice<'a>>, Vec<BindingIssue>> {
    let mut resolved = Vec::new();
    let mut issues = Vec::new();
    for instance in project
        .device_instances
        .iter()
        .filter(|instance| instance.model.is_some())
    {
        let components: Vec<_> = sheet
            .components
            .iter()
            .filter(|component| {
                component
                    .device
                    .as_ref()
                    .is_some_and(|binding| binding.logical_instance_id == Some(instance.id))
            })
            .collect();
        let component_id = components.first().map(|component| component.id);
        let Some(model_binding) = instance.model.as_ref() else {
            continue;
        };
        let definition = project
            .spice_libraries
            .iter()
            .find(|library| library.id == model_binding.library_id)
            .and_then(|library| {
                library.models.iter().find(|definition| {
                    definition
                        .name
                        .eq_ignore_ascii_case(&model_binding.model_name)
                        && definition.kind == model_binding.kind
                })
            });
        let Some(definition) = definition else {
            issues.push(BindingIssue {
                code: "simulation_binding.model_unavailable",
                message: format!(
                    "SPICE model '{}' for {} is unavailable",
                    model_binding.model_name, instance.reference
                ),
                component_id,
            });
            continue;
        };
        let Some(pack) = project
            .device_packs
            .iter()
            .find(|pack| pack.sha256 == instance.pack_sha256)
        else {
            issues.push(missing_metadata(&instance.reference, component_id));
            continue;
        };
        let Some(device) = pack
            .pack
            .devices
            .iter()
            .find(|device| device.id == instance.device_id)
        else {
            issues.push(missing_metadata(&instance.reference, component_id));
            continue;
        };
        let pack_model = device.model_ids.iter().find_map(|model_id| {
            pack.pack.models.iter().find(|model| {
                model.id == *model_id
                    && model.kind == DeviceModelKind::Spice
                    && model
                        .model_name
                        .as_deref()
                        .is_some_and(|name| name.eq_ignore_ascii_case(&model_binding.model_name))
            })
        });
        let Some(pack_model) = pack_model else {
            issues.push(missing_metadata(&instance.reference, component_id));
            continue;
        };
        let explicit = device
            .spice_bindings
            .iter()
            .find(|binding| binding.model_id == pack_model.id);
        let explicit_ports: BTreeMap<_, _> = explicit
            .into_iter()
            .flat_map(|binding| &binding.ports)
            .map(|port| (port.model_port.to_ascii_lowercase(), port.pin_id.as_str()))
            .collect();

        let mut placed = BTreeMap::new();
        let mut duplicates = BTreeSet::new();
        for component in &components {
            for pin in &component.pins {
                if placed
                    .insert(pin.id.as_str(), BoundPin { component, pin })
                    .is_some()
                {
                    duplicates.insert(pin.id.as_str());
                }
            }
        }
        if !duplicates.is_empty() {
            issues.push(BindingIssue {
                code: "simulation_binding.duplicate_pin",
                message: format!(
                    "Logical device {} places mapped pin(s) more than once: {}",
                    instance.reference,
                    duplicates.into_iter().collect::<Vec<_>>().join(", ")
                ),
                component_id,
            });
            continue;
        }

        let mut ordered = Vec::with_capacity(definition.pins.len());
        let mut failed = false;
        for model_port in &definition.pins {
            let pin_id = explicit_ports
                .get(&model_port.to_ascii_lowercase())
                .copied()
                .or_else(|| {
                    device
                        .pins
                        .iter()
                        .find(|pin| {
                            pin.id.eq_ignore_ascii_case(model_port)
                                || pin.name.eq_ignore_ascii_case(model_port)
                        })
                        .map(|pin| pin.id.as_str())
                });
            let bound = pin_id.and_then(|pin_id| placed.remove(pin_id));
            if let Some(bound) = bound {
                ordered.push(bound);
            } else {
                issues.push(BindingIssue {
                    code: "simulation_binding.missing_pin",
                    message: format!(
                        "Logical device {} is missing the placed pin for SPICE port '{}'",
                        instance.reference, model_port
                    ),
                    component_id,
                });
                failed = true;
            }
        }
        if !failed {
            resolved.push(ResolvedDevice {
                reference: &instance.reference,
                model: model_binding,
                pins: ordered,
            });
        }
    }
    resolved.sort_by(|a, b| a.reference.cmp(b.reference));
    if issues.is_empty() {
        Ok(resolved)
    } else {
        Err(issues)
    }
}

fn missing_metadata(reference: &str, component_id: Option<Uuid>) -> BindingIssue {
    BindingIssue {
        code: "simulation_binding.metadata_unavailable",
        message: format!("DevicePack simulation metadata for {reference} is unavailable"),
        component_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Point;

    #[test]
    fn resolves_ports_across_two_symbol_units_once() {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-analog.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("split model");
        project.spice_libraries = crate::device_pack::embedded_spice_libraries(&pack).unwrap();
        project.device_packs.push(pack.clone());
        let analog = crate::device_instance::place_unit(
            &mut project,
            &pack.sha256,
            "sta100",
            None,
            Some("a"),
            None,
            Point { x: 0.0, y: 0.0 },
        )
        .unwrap();
        let logical_id = analog.device.as_ref().unwrap().logical_instance_id;
        project.sheets[0].components.push(analog);
        assert!(resolve(&project, &project.sheets[0]).is_err());
        let power = crate::device_instance::place_unit(
            &mut project,
            &pack.sha256,
            "sta100",
            None,
            Some("power"),
            logical_id,
            Point { x: 300.0, y: 0.0 },
        )
        .unwrap();
        project.sheets[0].components.push(power);
        let devices = resolve(&project, &project.sheets[0]).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(
            devices[0]
                .pins
                .iter()
                .map(|bound| bound.pin.id.as_str())
                .collect::<Vec<_>>(),
            ["inp", "inm", "vcc", "vee", "out"]
        );

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("split-model.sugeda");
        crate::project::save(&path, &project).unwrap();
        let reopened = crate::project::load(&path).unwrap();
        let reopened_devices = resolve(&reopened, &reopened.sheets[0]).unwrap();
        assert_eq!(reopened_devices.len(), 1);
        assert_eq!(reopened_devices[0].reference, "X1");
    }
}
