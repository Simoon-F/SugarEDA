use super::DevicePackSpiceModelFileReport;
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn inspect_device_pack_spice_model_file(
    path: String,
) -> Result<DevicePackSpiceModelFileReport, String> {
    inspect_path(PathBuf::from(path))
}

fn inspect_path(path: PathBuf) -> Result<DevicePackSpiceModelFileReport, String> {
    let metadata = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() {
        return Err("SPICE model source must be a regular, non-symlink file".into());
    }
    let library = crate::models::import(&path).map_err(|error| error.to_string())?;
    Ok(DevicePackSpiceModelFileReport {
        source_file_name: library.source_name,
        bytes: metadata.len(),
        sha256: library.sha256,
        definitions: library.models,
        embedded_content: library.content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_safe_embeddable_model_without_source_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("safe.lib");
        std::fs::write(&path, ".subckt SAFE IN OUT\nR1 IN OUT 1k\n.ends SAFE\n").unwrap();
        let report = inspect_path(path).unwrap();
        assert_eq!(report.source_file_name, "safe.lib");
        assert_eq!(report.definitions[0].name, "SAFE");
        assert!(report.embedded_content.contains(".subckt SAFE"));
        assert_eq!(report.sha256.len(), 64);
    }

    #[test]
    fn rejects_external_file_directives() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("unsafe.lib");
        std::fs::write(&path, ".include \"outside.lib\"\n").unwrap();
        assert!(inspect_path(path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("safe.lib");
        let link = directory.path().join("linked.lib");
        std::fs::write(&target, ".model DTEST D(IS=1e-9)\n").unwrap();
        symlink(target, &link).unwrap();
        assert!(inspect_path(link).is_err());
    }
}
