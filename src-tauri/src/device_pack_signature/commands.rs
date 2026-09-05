use super::{inspect_files, DevicePackSignatureReport};
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn inspect_device_pack_signature(
    pack_path: String,
    signature_path: String,
) -> Result<DevicePackSignatureReport, String> {
    inspect_files(&PathBuf::from(pack_path), &PathBuf::from(signature_path))
}
