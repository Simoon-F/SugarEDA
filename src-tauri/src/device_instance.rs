//! Lifecycle for logical device instances and their independently placed symbol units.
//!
//! Device-pack parsing/layout remains in `device_pack`; this module is the only
//! place that creates, reuses, migrates, validates, or removes shared instances.

use crate::domain::{Component, DeviceInstance, Point, Project};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub fn place_unit(
    project: &mut Project,
    pack_hash: &str,
    device_id: &str,
    variant_id: Option<&str>,
    unit_id: Option<&str>,
    logical_instance_id: Option<Uuid>,
    position: Point,
) -> Result<Component, String> {
    let mut component = crate::device_pack::instantiate(
        project, pack_hash, device_id, variant_id, unit_id, position,
    )?;

    let instance = if let Some(id) = logical_instance_id {
        let instance = project
            .device_instances
            .iter()
            .find(|instance| instance.id == id)
            .ok_or_else(|| format!("Logical device instance '{id}' is unavailable"))?
            .clone();
        ensure_compatible(&instance, pack_hash, device_id, variant_id)?;
        if project
            .sheets
            .iter()
            .flat_map(|sheet| &sheet.components)
            .any(|placed| {
                placed.device.as_ref().is_some_and(|binding| {
                    binding.logical_instance_id == Some(id)
                        && binding.symbol_unit_id.as_deref()
                            == component
                                .device
                                .as_ref()
                                .and_then(|binding| binding.symbol_unit_id.as_deref())
                })
            })
        {
            return Err(
                "This symbol unit is already placed for the selected device instance".into(),
            );
        }
        instance
    } else {
        let binding = component
            .device
            .as_ref()
            .expect("device-pack instantiation always has a binding");
        let instance = DeviceInstance {
            id: Uuid::new_v4(),
            pack_sha256: binding.pack_sha256.clone(),
            pack_id: binding.pack_id.clone(),
            pack_version: binding.pack_version.clone(),
            device_id: binding.device_id.clone(),
            variant_id: binding.variant_id.clone(),
            reference: component.spice_ref.clone(),
            display_name: component.display_name.clone(),
            model: component.model.clone(),
            capabilities: binding.capabilities.clone(),
        };
        project.device_instances.push(instance.clone());
        instance
    };

    component.spice_ref = instance.reference.clone();
    component.display_name = instance.display_name.clone();
    component.model = instance.model.clone();
    component
        .device
        .as_mut()
        .expect("device-pack instantiation always has a binding")
        .logical_instance_id = Some(instance.id);
    Ok(component)
}

fn ensure_compatible(
    instance: &DeviceInstance,
    pack_hash: &str,
    device_id: &str,
    variant_id: Option<&str>,
) -> Result<(), String> {
    if instance.pack_sha256 != pack_hash
        || instance.device_id != device_id
        || instance.variant_id.as_deref() != variant_id
    {
        return Err("Selected logical instance belongs to another device or variant".into());
    }
    Ok(())
}

pub fn remove_orphans(project: &mut Project) {
    let used: BTreeSet<_> = project
        .sheets
        .iter()
        .flat_map(|sheet| &sheet.components)
        .filter_map(|component| component.device.as_ref()?.logical_instance_id)
        .collect();
    project
        .device_instances
        .retain(|instance| used.contains(&instance.id));
}

pub fn update_identity(
    project: &mut Project,
    component_id: Uuid,
    display_name: &str,
    reference: &str,
) -> Result<bool, String> {
    let logical_id = project
        .sheets
        .iter()
        .flat_map(|sheet| &sheet.components)
        .find(|component| component.id == component_id)
        .and_then(|component| component.device.as_ref())
        .and_then(|binding| binding.logical_instance_id);
    let Some(logical_id) = logical_id else {
        return Ok(false);
    };
    let instance = project
        .device_instances
        .iter_mut()
        .find(|instance| instance.id == logical_id)
        .ok_or_else(|| "Device component references an unknown logical instance".to_owned())?;
    instance.display_name = display_name.to_owned();
    instance.reference = reference.to_owned();
    for component in project
        .sheets
        .iter_mut()
        .flat_map(|sheet| &mut sheet.components)
    {
        if component
            .device
            .as_ref()
            .is_some_and(|binding| binding.logical_instance_id == Some(logical_id))
        {
            component.display_name = display_name.to_owned();
            component.spice_ref = reference.to_owned();
        }
    }
    Ok(true)
}

/// Upgrade v3's one-component-per-part representation without changing its semantics.
pub fn migrate_legacy_components(project: &mut Project) {
    for component in project
        .sheets
        .iter_mut()
        .flat_map(|sheet| &mut sheet.components)
    {
        let Some(binding) = component.device.as_mut() else {
            continue;
        };
        if binding.logical_instance_id.is_some() {
            continue;
        }
        let id = Uuid::new_v4();
        project.device_instances.push(DeviceInstance {
            id,
            pack_sha256: binding.pack_sha256.clone(),
            pack_id: binding.pack_id.clone(),
            pack_version: binding.pack_version.clone(),
            device_id: binding.device_id.clone(),
            variant_id: binding.variant_id.clone(),
            reference: component.spice_ref.clone(),
            display_name: component.display_name.clone(),
            model: component.model.clone(),
            capabilities: binding.capabilities.clone(),
        });
        binding.logical_instance_id = Some(id);
    }
}

pub fn validate(project: &Project) -> Result<(), String> {
    let instances: BTreeMap<_, _> = project
        .device_instances
        .iter()
        .map(|instance| (instance.id, instance))
        .collect();
    if instances.len() != project.device_instances.len() {
        return Err("duplicate logical device instance id".into());
    }
    for instance in &project.device_instances {
        let pack = project
            .device_packs
            .iter()
            .find(|pack| pack.sha256 == instance.pack_sha256)
            .ok_or_else(|| "logical instance references an unknown device pack".to_owned())?;
        let device = pack
            .pack
            .devices
            .iter()
            .find(|device| device.id == instance.device_id)
            .ok_or_else(|| "logical instance references an unknown device".to_owned())?;
        if pack.pack.manifest.id != instance.pack_id
            || pack.pack.manifest.version != instance.pack_version
            || instance
                .variant_id
                .as_ref()
                .is_some_and(|id| !device.variants.iter().any(|variant| &variant.id == id))
        {
            return Err("logical instance pack or variant binding is inconsistent".into());
        }
    }
    let mut placed_units = BTreeSet::new();
    let mut used_instances = BTreeSet::new();
    for component in project.sheets.iter().flat_map(|sheet| &sheet.components) {
        let Some(binding) = component.device.as_ref() else {
            continue;
        };
        let Some(id) = binding.logical_instance_id else {
            return Err("device component has no logical instance".into());
        };
        let Some(instance) = instances.get(&id) else {
            return Err("device component references an unknown logical instance".into());
        };
        used_instances.insert(id);
        if instance.pack_sha256 != binding.pack_sha256
            || instance.pack_id != binding.pack_id
            || instance.pack_version != binding.pack_version
            || instance.device_id != binding.device_id
            || instance.variant_id != binding.variant_id
            || instance.reference != component.spice_ref
            || instance.display_name != component.display_name
            || instance.model != component.model
        {
            return Err("device component and logical instance are inconsistent".into());
        }
        if !placed_units.insert((id, binding.symbol_unit_id.as_deref())) {
            return Err("a symbol unit is placed more than once for one logical instance".into());
        }
    }
    if used_instances.len() != project.device_instances.len() {
        return Err("logical device instance has no placed symbol unit".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_can_share_one_reference_and_reject_duplicates() {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("multi-unit");
        project.device_packs.push(pack.clone());
        let core = place_unit(
            &mut project,
            &pack.sha256,
            "stmcu24",
            Some("industrial"),
            Some("core"),
            None,
            Point { x: 0.0, y: 0.0 },
        )
        .unwrap();
        let id = core.device.as_ref().unwrap().logical_instance_id.unwrap();
        project.sheets[0].components.push(core.clone());
        let io = place_unit(
            &mut project,
            &pack.sha256,
            "stmcu24",
            Some("industrial"),
            Some("io"),
            Some(id),
            Point { x: 300.0, y: 0.0 },
        )
        .unwrap();
        assert_eq!(core.spice_ref, io.spice_ref);
        project.sheets[0].components.push(io);
        assert!(validate(&project).is_ok());
        assert!(crate::project::validate(&project).is_ok());
        assert!(place_unit(
            &mut project,
            &pack.sha256,
            "stmcu24",
            Some("industrial"),
            Some("core"),
            Some(id),
            Point { x: 600.0, y: 0.0 },
        )
        .is_err());
        project.sheets[0].components.clear();
        remove_orphans(&mut project);
        assert!(project.device_instances.is_empty());
    }
}
