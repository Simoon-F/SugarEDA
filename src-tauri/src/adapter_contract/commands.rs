use super::{inspect_manifest, AdapterContractReport};
use std::path::PathBuf;

const MAX_ADAPTER_MANIFEST_BYTES: u64 = 256 * 1024;

#[tauri::command]
pub(crate) fn validate_adapter_contract(path: String) -> Result<AdapterContractReport, String> {
    let path = PathBuf::from(path);
    if !path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".sugareda-adapter.json"))
    {
        return Err("Adapter manifest requires the .sugareda-adapter.json extension".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_ADAPTER_MANIFEST_BYTES {
        return Err("Adapter manifest must be a regular file no larger than 256 KiB".into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    Ok(inspect_manifest(&bytes))
}
