use super::{
    validation::configuration_capable, BoardConfiguration, BoardConfigurationSourceFormat,
};
use crate::{
    device_config::{self, DeviceConfig, DeviceConfigReport},
    domain::Project,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) fn validate_draft(
    project: &Project,
    logical_instance_id: Uuid,
    config: &DeviceConfig,
) -> Result<DeviceConfigReport, String> {
    device_config::validate_ir(config).map_err(|error| error.to_string())?;
    let instance = project
        .device_instances
        .iter()
        .find(|instance| instance.id == logical_instance_id)
        .ok_or_else(|| "Logical device instance no longer exists".to_owned())?;
    if !configuration_capable(project, &instance.pack_sha256, &instance.device_id) {
        return Err(
            "[board-config.unsupported-device] Device does not declare configuration metadata"
                .into(),
        );
    }
    if config.target.pack_id != instance.pack_id
        || config.target.pack_version != instance.pack_version
        || config.target.device_id != instance.device_id
        || config.target.variant_id != instance.variant_id
    {
        return Err(
            "[board-config.target-mismatch] Draft target does not match the selected logical instance"
                .into(),
        );
    }
    device_config::check_ir(project, &instance.pack_sha256, &instance.device_id, config)
        .map_err(|error| error.to_string())
}

pub(crate) fn build_from_draft(
    project: &Project,
    logical_instance_id: Uuid,
    config: DeviceConfig,
) -> Result<BoardConfiguration, String> {
    let report = validate_draft(project, logical_instance_id, &config)?;
    if !report.valid {
        return Err(format!(
            "[board-config.draft-invalid] Draft has {} semantic issue(s)",
            report.issues.len()
        ));
    }
    let instance = project
        .device_instances
        .iter()
        .find(|instance| instance.id == logical_instance_id)
        .ok_or_else(|| "Logical device instance no longer exists".to_owned())?;
    let config = canonicalize(config);
    let bytes = serde_json::to_vec(&config).map_err(|error| error.to_string())?;
    Ok(BoardConfiguration {
        id: Uuid::new_v4(),
        logical_instance_id,
        source_format: BoardConfigurationSourceFormat::Json,
        source_name: generated_source_name(&instance.reference),
        source_sha256: format!("{:x}", Sha256::digest(bytes)),
        config,
    })
}

pub(super) fn canonicalize(mut config: DeviceConfig) -> DeviceConfig {
    config
        .pin_mux
        .sort_by(|left, right| left.pin_id.cmp(&right.pin_id));
    config
        .boot_straps
        .sort_by(|left, right| left.pin_id.cmp(&right.pin_id));
    config
        .voltage_selections
        .sort_by(|left, right| left.domain_id.cmp(&right.domain_id));
    config
}

fn generated_source_name(reference: &str) -> String {
    let stem = reference
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    format!(
        "{}.device-config.json",
        if stem.is_empty() { "device" } else { &stem }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Point;

    fn configured_project() -> (Project, Uuid, DeviceConfig) {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("draft");
        let hash = pack.sha256.clone();
        project.device_packs.push(pack);
        let component = crate::device_instance::place_unit(
            &mut project,
            &hash,
            "stmcu24",
            Some("industrial"),
            Some("core"),
            None,
            Point { x: 0.0, y: 0.0 },
        )
        .unwrap();
        let instance_id = component
            .device
            .as_ref()
            .unwrap()
            .logical_instance_id
            .unwrap();
        project.sheets[0].components.push(component);
        let config = crate::device_config::parse_ir(include_bytes!(
            "../../../examples/device-configs/test-mcu-valid.device-config.json"
        ))
        .unwrap();
        (project, instance_id, config)
    }

    #[test]
    fn validates_and_canonicalizes_visual_draft() {
        let (project, instance_id, mut config) = configured_project();
        config.pin_mux.reverse();
        assert!(
            validate_draft(&project, instance_id, &config)
                .unwrap()
                .valid
        );
        let stored = build_from_draft(&project, instance_id, config).unwrap();
        assert_eq!(stored.source_name, "u1.device-config.json");
        assert!(stored
            .config
            .pin_mux
            .windows(2)
            .all(|items| items[0].pin_id <= items[1].pin_id));
    }

    #[test]
    fn refuses_invalid_visual_draft_and_mismatched_instance() {
        let (project, instance_id, mut config) = configured_project();
        config.pin_mux.retain(|item| item.function != "UART1_RX");
        assert!(
            !validate_draft(&project, instance_id, &config)
                .unwrap()
                .valid
        );
        assert!(build_from_draft(&project, instance_id, config.clone()).is_err());
        config.target.device_id = "other".into();
        assert!(validate_draft(&project, instance_id, &config).is_err());
    }
}
