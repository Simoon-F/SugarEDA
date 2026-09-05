use super::{
    types::{BoardConfigurationCheckEntry, UnconfiguredDeviceInstance},
    validation::configuration_capable,
    BoardConfigurationCheckReport,
};
use crate::{device_config, domain::Project};
use std::collections::BTreeSet;

pub fn check_all(project: &Project) -> Result<BoardConfigurationCheckReport, String> {
    let eligible = project
        .device_instances
        .iter()
        .filter(|instance| {
            configuration_capable(project, &instance.pack_sha256, &instance.device_id)
        })
        .collect::<Vec<_>>();
    let mut entries = Vec::with_capacity(project.board_configurations.len());
    for configuration in &project.board_configurations {
        let instance = project
            .device_instances
            .iter()
            .find(|instance| instance.id == configuration.logical_instance_id)
            .ok_or_else(|| "Board configuration references an unknown instance".to_owned())?;
        let report = device_config::check_ir(
            project,
            &instance.pack_sha256,
            &instance.device_id,
            &configuration.config,
        )
        .map_err(|error| error.to_string())?;
        entries.push(BoardConfigurationCheckEntry {
            board_configuration_id: configuration.id,
            logical_instance_id: instance.id,
            reference: instance.reference.clone(),
            source_name: configuration.source_name.clone(),
            source_format: configuration.source_format,
            report,
        });
    }
    let configured = project
        .board_configurations
        .iter()
        .map(|configuration| configuration.logical_instance_id)
        .collect::<BTreeSet<_>>();
    let unconfigured = eligible
        .iter()
        .filter(|instance| !configured.contains(&instance.id))
        .map(|instance| UnconfiguredDeviceInstance {
            logical_instance_id: instance.id,
            reference: instance.reference.clone(),
            device_id: instance.device_id.clone(),
            code: "board-config.missing",
            message_zh: format!("器件实例 {} 尚未绑定板级配置", instance.reference),
            message_en: format!(
                "Device instance {} has no board configuration",
                instance.reference
            ),
        })
        .collect::<Vec<_>>();
    let passed = unconfigured.is_empty() && entries.iter().all(|entry| entry.report.valid);
    Ok(BoardConfigurationCheckReport {
        passed,
        eligible_instances: eligible.len(),
        configured_instances: entries.len(),
        entries,
        unconfigured,
    })
}
