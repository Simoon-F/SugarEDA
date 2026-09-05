use super::{inspect_draft, DevicePackExportReceipt};
use crate::device_pack::DevicePack;
use std::{io::Write, path::Path};

const MAX_EXPORTED_PACK_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn write_draft(
    pack: &DevicePack,
    path: &Path,
) -> Result<DevicePackExportReceipt, String> {
    let report = inspect_draft(pack);
    if !report.valid {
        return Err(format!(
            "[device-pack.invalid-draft] {}",
            report
                .issues
                .first()
                .map(|issue| issue.message.as_str())
                .unwrap_or("DevicePack draft is invalid")
        ));
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "DevicePack export filename is invalid".to_owned())?;
    if !(name.ends_with(".devicepack.json") || name.ends_with(".sugeda-pack.json")) {
        return Err("DevicePack export requires .devicepack.json or .sugeda-pack.json".into());
    }
    let bytes = serde_json::to_vec_pretty(pack).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_EXPORTED_PACK_BYTES {
        return Err("DevicePack export exceeds the 8 MiB limit".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "DevicePack export path has no parent".to_owned())?;
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
    Ok(DevicePackExportReceipt {
        path: path.display().to_string(),
        bytes_written: bytes.len(),
        pack_sha256: report.pack_sha256.expect("valid report has a hash"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_a_valid_pack_that_the_normal_importer_reopens() {
        let embedded = crate::device_pack::import_bytes(include_bytes!(
            "../../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("authored.devicepack.json");
        let receipt = write_draft(&embedded.pack, &path).unwrap();
        let reopened = crate::device_pack::import(&path).unwrap();
        assert_eq!(receipt.pack_sha256, reopened.sha256);
        assert_eq!(reopened.pack, embedded.pack);
    }
}
