use super::BoardConfiguration;
use crate::{device_config, device_pack::DeviceRuleKind, domain::Project};
use std::collections::BTreeSet;

const MAX_BOARD_CONFIGURATIONS: usize = 4096;

pub(crate) fn validate_project(project: &Project) -> Result<(), String> {
    if project.board_configurations.len() > MAX_BOARD_CONFIGURATIONS {
        return Err(format!(
            "board configuration count exceeds {MAX_BOARD_CONFIGURATIONS}"
        ));
    }
    let mut ids = BTreeSet::new();
    let mut instances = BTreeSet::new();
    for configuration in &project.board_configurations {
        if !ids.insert(configuration.id) {
            return Err("duplicate board configuration id".into());
        }
        if !instances.insert(configuration.logical_instance_id) {
            return Err("a logical instance has more than one board configuration".into());
        }
        validate_candidate(project, configuration)?;
    }
    Ok(())
}

pub(crate) fn validate_candidate(
    project: &Project,
    configuration: &BoardConfiguration,
) -> Result<(), String> {
    if configuration.source_name.is_empty()
        || configuration.source_name.len() > 255
        || configuration.source_name.contains(['/', '\\'])
        || configuration.source_name.chars().any(char::is_control)
    {
        return Err("invalid board configuration source name".into());
    }
    if configuration.source_sha256.len() != 64
        || !configuration
            .source_sha256
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
    {
        return Err("invalid board configuration source hash".into());
    }
    device_config::validate_ir(&configuration.config).map_err(|error| error.to_string())?;
    let instance = project
        .device_instances
        .iter()
        .find(|instance| instance.id == configuration.logical_instance_id)
        .ok_or_else(|| "board configuration references an unknown logical instance".to_owned())?;
    if !configuration_capable(project, &instance.pack_sha256, &instance.device_id) {
        return Err(
            "[board-config.unsupported-device] Device does not declare PinMux or boot configuration metadata"
                .into(),
        );
    }
    if configuration.config.target.pack_id != instance.pack_id
        || configuration.config.target.pack_version != instance.pack_version
        || configuration.config.target.device_id != instance.device_id
        || configuration.config.target.variant_id != instance.variant_id
    {
        return Err("[board-config.target-mismatch] Configuration target does not match the selected logical instance".into());
    }
    Ok(())
}

pub(super) fn configuration_capable(project: &Project, pack_sha256: &str, device_id: &str) -> bool {
    project
        .device_packs
        .iter()
        .find(|pack| pack.sha256 == pack_sha256)
        .and_then(|pack| {
            pack.pack
                .devices
                .iter()
                .find(|device| device.id == device_id)
        })
        .is_some_and(|device| {
            !device.alternate_functions.is_empty()
                || device
                    .rules
                    .iter()
                    .any(|rule| rule.kind == DeviceRuleKind::BootConfiguration)
        })
}
