use super::{validation::validate_candidate, BoardConfiguration, BoardConfigurationSourceFormat};
use crate::{device_config, device_tree_adapter, domain::Project};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use uuid::Uuid;

const MAX_SOURCE_BYTES: u64 = 1024 * 1024;

pub(crate) fn load_for_instance(
    project: &Project,
    logical_instance_id: Uuid,
    path: &Path,
    source_format: BoardConfigurationSourceFormat,
) -> Result<BoardConfiguration, String> {
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Configuration source name is not valid UTF-8".to_owned())?
        .to_owned();
    validate_extension(&source_name, source_format)?;
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Configuration source is not a regular file".into());
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err("Configuration source exceeds the 1 MiB limit".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("Configuration source exceeds the 1 MiB limit".into());
    }
    let config = match source_format {
        BoardConfigurationSourceFormat::Json => {
            device_config::parse_ir(&bytes).map_err(|error| error.to_string())?
        }
        BoardConfigurationSourceFormat::DeviceTreeSubset => {
            device_tree_adapter::translate_ir(&bytes)
                .map_err(|issue| {
                    format!(
                        "[{}] {}{}",
                        issue.code,
                        issue.message_en,
                        issue
                            .line
                            .map(|line| format!(" at {line}:{}", issue.column.unwrap_or(1)))
                            .unwrap_or_default()
                    )
                })?
                .config
        }
    };
    let configuration = BoardConfiguration {
        id: Uuid::new_v4(),
        logical_instance_id,
        source_format,
        source_name,
        source_sha256: format!("{:x}", Sha256::digest(&bytes)),
        config,
    };
    validate_candidate(project, &configuration)?;
    Ok(configuration)
}

fn validate_extension(
    source_name: &str,
    source_format: BoardConfigurationSourceFormat,
) -> Result<(), String> {
    let valid = match source_format {
        BoardConfigurationSourceFormat::Json => source_name.ends_with(".device-config.json"),
        BoardConfigurationSourceFormat::DeviceTreeSubset => source_name.ends_with(".sugareda.dts"),
    };
    valid
        .then_some(())
        .ok_or_else(|| "Configuration source extension does not match its format".into())
}
