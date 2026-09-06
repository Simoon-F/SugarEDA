use super::{
    inspect_files, read_signature_envelope, DevicePackSignatureReport, DevicePackTrustStore,
    PortableTrustedDevicePackKey, TrustedDevicePackKey, TrustedDevicePackKeyExportReceipt,
};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
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

#[tauri::command]
pub(crate) fn import_trusted_device_pack_key(
    path: String,
    app: tauri::AppHandle,
) -> Result<Vec<TrustedDevicePackKey>, String> {
    let path = PathBuf::from(path);
    validate_portable_path(&path)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > 64 * 1024 {
        return Err("Trusted-key import must be a regular file no larger than 64 KiB".into());
    }
    let key: PortableTrustedDevicePackKey =
        serde_json::from_slice(&std::fs::read(&path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    trust_store(&app)?.import_portable(key)
}

#[tauri::command]
pub(crate) fn export_trusted_device_pack_key(
    fingerprint: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<TrustedDevicePackKeyExportReceipt, String> {
    let path = PathBuf::from(path);
    validate_portable_path(&path)?;
    let key = trust_store(&app)?.portable(&fingerprint)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Trusted-key export path has no parent".to_owned())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(&key).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist(&path)
        .map_err(|error| error.error.to_string())?;
    Ok(TrustedDevicePackKeyExportReceipt {
        path: path.to_string_lossy().into_owned(),
        fingerprint: key.fingerprint,
    })
}

fn validate_portable_path(path: &Path) -> Result<(), String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".sugareda-trusted-key.json"))
        .then_some(())
        .ok_or_else(|| "Trusted DevicePack keys must use .sugareda-trusted-key.json".to_owned())
}
