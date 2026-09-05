use crate::domain::{Project, SCHEMA_VERSION};
use crate::models::ModelImportError;
use std::{fs, io::Write, path::Path};
use thiserror::Error;

const MAX_PROJECT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("project path must use the .sugeda extension")]
    Extension,
    #[error("project file is larger than 16 MiB")]
    TooLarge,
    #[error("cannot read project: {0}")]
    Read(#[from] std::io::Error),
    #[error("project JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported schema version {0}; this app supports version {SCHEMA_VERSION}")]
    Schema(u32),
    #[error("project must contain at least one schematic sheet")]
    NoSheets,
    #[error("embedded SPICE model is invalid: {0}")]
    Model(#[from] ModelImportError),
}

pub fn load(path: &Path) -> Result<Project, ProjectError> {
    validate_extension(path)?;
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let bytes = fs::read(path)?;
    let mut project: Project = serde_json::from_slice(&bytes)?;
    if project.schema_version == 1 {
        project.schema_version = SCHEMA_VERSION;
    }
    validate(&project)?;
    Ok(project)
}

pub fn save(path: &Path, project: &Project) -> Result<(), ProjectError> {
    validate_extension(path)?;
    validate(project)?;
    let parent = path.parent().ok_or(ProjectError::Extension)?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec_pretty(project)?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|error| ProjectError::Read(error.error))?;
    Ok(())
}

fn validate_extension(path: &Path) -> Result<(), ProjectError> {
    match path.extension().and_then(|v| v.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("sugeda") => Ok(()),
        _ => Err(ProjectError::Extension),
    }
}

pub fn validate(project: &Project) -> Result<(), ProjectError> {
    if project.schema_version != SCHEMA_VERSION {
        return Err(ProjectError::Schema(project.schema_version));
    }
    if project.sheets.is_empty() {
        return Err(ProjectError::NoSheets);
    }
    for library in &project.spice_libraries {
        crate::models::validate_library(library)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_preserves_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("round-trip.sugeda");
        let project = crate::domain::test_rc_project();
        save(&path, &project).unwrap();
        assert_eq!(project, load(&path).unwrap());
    }
}
