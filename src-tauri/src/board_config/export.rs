use super::{
    editor::canonicalize, BoardConfigurationExportFormat, BoardConfigurationExportReceipt,
};
use crate::{device_config::BootStrapValue, domain::Project};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};
use uuid::Uuid;

pub(crate) fn export_configuration(
    project: &Project,
    configuration_id: Uuid,
    path: &Path,
    format: BoardConfigurationExportFormat,
) -> Result<BoardConfigurationExportReceipt, String> {
    validate_extension(path, format)?;
    let configuration = project
        .board_configurations
        .iter()
        .find(|configuration| configuration.id == configuration_id)
        .ok_or_else(|| "Board configuration no longer exists".to_owned())?;
    let config = canonicalize(configuration.config.clone());
    let bytes = match format {
        BoardConfigurationExportFormat::Json => {
            serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?
        }
        BoardConfigurationExportFormat::DeviceTreeSubset => write_device_tree(&config).into_bytes(),
    };
    let parent = path
        .parent()
        .ok_or_else(|| "Export path does not have a parent directory".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(BoardConfigurationExportReceipt {
        path: path.display().to_string(),
        format,
        bytes_written: bytes.len(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
    })
}

fn validate_extension(path: &Path, format: BoardConfigurationExportFormat) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Export filename is not valid UTF-8".to_owned())?;
    let valid = match format {
        BoardConfigurationExportFormat::Json => name.ends_with(".device-config.json"),
        BoardConfigurationExportFormat::DeviceTreeSubset => name.ends_with(".sugareda.dts"),
    };
    valid
        .then_some(())
        .ok_or_else(|| "Export filename extension does not match its format".into())
}

fn write_device_tree(config: &crate::device_config::DeviceConfig) -> String {
    let mut text = String::from("/dts-v1/;\n\n/ {\n  sugareda-device-config {\n");
    property(&mut text, "compatible", "sugareda,device-config-v1");
    property(&mut text, "config-id", &config.id);
    property(&mut text, "config-name", &config.name);
    property(&mut text, "source", &config.source);
    property(&mut text, "license", &config.license);
    property(&mut text, "pack-id", &config.target.pack_id);
    property(&mut text, "pack-version", &config.target.pack_version);
    property(&mut text, "device-id", &config.target.device_id);
    if let Some(variant_id) = &config.target.variant_id {
        property(&mut text, "variant-id", variant_id);
    }
    if !config.pin_mux.is_empty() {
        text.push_str("\n    pinmux {\n");
        for (index, assignment) in config.pin_mux.iter().enumerate() {
            text.push_str(&format!(
                "      assignment@{index} {{ pin = \"{}\"; function = \"{}\"; }};\n",
                escape(&assignment.pin_id),
                escape(&assignment.function)
            ));
        }
        text.push_str("    };\n");
    }
    if !config.boot_straps.is_empty() {
        text.push_str("\n    boot-straps {\n");
        for (index, strap) in config.boot_straps.iter().enumerate() {
            let value = match strap.value {
                BootStrapValue::Low => "low",
                BootStrapValue::High => "high",
                BootStrapValue::PullDown => "pull-down",
                BootStrapValue::PullUp => "pull-up",
                BootStrapValue::External => "external",
            };
            text.push_str(&format!(
                "      strap@{index} {{ pin = \"{}\"; value = \"{value}\"; }};\n",
                escape(&strap.pin_id)
            ));
        }
        text.push_str("    };\n");
    }
    if !config.voltage_selections.is_empty() {
        text.push_str("\n    voltage-domains {\n");
        for (index, selection) in config.voltage_selections.iter().enumerate() {
            text.push_str(&format!(
                "      selection@{index} {{ domain = \"{}\"; voltage = \"{}\"; }};\n",
                escape(&selection.domain_id),
                selection.voltage
            ));
        }
        text.push_str("    };\n");
    }
    text.push_str("  };\n};\n");
    text
}

fn property(output: &mut String, name: &str, value: &str) {
    output.push_str(&format!("    {name} = \"{}\";\n", escape(value)));
}

fn escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Point;

    fn project_with_configuration() -> (Project, Uuid) {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let mut project = Project::blank("export");
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
        let configuration = super::super::build_from_draft(&project, instance_id, config).unwrap();
        let id = configuration.id;
        project.board_configurations.push(configuration);
        (project, id)
    }

    #[test]
    fn exports_deterministic_json_and_parseable_restricted_dts() {
        let (project, id) = project_with_configuration();
        let directory = tempfile::tempdir().unwrap();
        let json_path = directory.path().join("u1.device-config.json");
        let dts_path = directory.path().join("u1.sugareda.dts");
        let json_receipt = export_configuration(
            &project,
            id,
            &json_path,
            BoardConfigurationExportFormat::Json,
        )
        .unwrap();
        assert!(json_receipt.bytes_written > 100);
        export_configuration(
            &project,
            id,
            &dts_path,
            BoardConfigurationExportFormat::DeviceTreeSubset,
        )
        .unwrap();
        let translated =
            crate::device_tree_adapter::translate_ir(&std::fs::read(dts_path).unwrap()).unwrap();
        assert_eq!(translated.config, project.board_configurations[0].config);
    }

    #[test]
    fn refuses_mismatched_export_extension() {
        let (project, id) = project_with_configuration();
        let directory = tempfile::tempdir().unwrap();
        assert!(export_configuration(
            &project,
            id,
            &directory.path().join("wrong.json"),
            BoardConfigurationExportFormat::Json,
        )
        .is_err());
    }
}
