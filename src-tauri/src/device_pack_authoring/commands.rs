use super::{inspect_draft, write_draft, DevicePackAuthoringReport, DevicePackExportReceipt};
use crate::device_pack::DevicePack;
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn validate_device_pack_draft(pack: DevicePack) -> DevicePackAuthoringReport {
    inspect_draft(&pack)
}

#[tauri::command]
pub(crate) fn export_device_pack_draft(
    pack: DevicePack,
    path: String,
) -> Result<DevicePackExportReceipt, String> {
    write_draft(&pack, &PathBuf::from(path))
}
