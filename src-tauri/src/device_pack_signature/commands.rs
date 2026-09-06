use super::{
    inspect_files, read_signature_envelope, DevicePackSignatureReport, DevicePackTrustStore,
    TrustedDevicePackKey,
};
use std::path::PathBuf;
use tauri::Manager;

fn trust_store(app: &tauri::AppHandle) -> Result<DevicePackTrustStore, String> {
    Ok(DevicePackTrustStore::new(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("trusted-device-pack-keys-v1.json"),
    ))
}

#[tauri::command]
pub(crate) fn inspect_device_pack_signature(
    pack_path: String,
    signature_path: String,
    app: tauri::AppHandle,
) -> Result<DevicePackSignatureReport, String> {
    let keys = trust_store(&app)?.list()?;
    inspect_files(
        &PathBuf::from(pack_path),
        &PathBuf::from(signature_path),
        &keys,
    )
}

#[tauri::command]
pub(crate) fn list_trusted_device_pack_keys(
    app: tauri::AppHandle,
) -> Result<Vec<TrustedDevicePackKey>, String> {
    trust_store(&app)?.list()
}

#[tauri::command]
pub(crate) fn trust_device_pack_signature_key(
    pack_path: String,
    signature_path: String,
    app: tauri::AppHandle,
) -> Result<Vec<TrustedDevicePackKey>, String> {
    let pack_path = PathBuf::from(pack_path);
    let signature_path = PathBuf::from(signature_path);
    let store = trust_store(&app)?;
    let keys = store.list()?;
    let report = inspect_files(&pack_path, &signature_path, &keys)?;
    if !report.verified {
        return Err("Only a cryptographically verified DevicePack key can be trusted".into());
    }
    let envelope = read_signature_envelope(&signature_path)?;
    store.trust(&envelope)
}

#[tauri::command]
pub(crate) fn remove_trusted_device_pack_key(
    fingerprint: String,
    app: tauri::AppHandle,
) -> Result<Vec<TrustedDevicePackKey>, String> {
    trust_store(&app)?.remove(&fingerprint)
}
