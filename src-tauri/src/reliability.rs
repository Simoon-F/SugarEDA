use crate::domain::Project;
use chrono::{DateTime, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const RECOVERY_VERSION: u32 = 1;
const MAX_RECENT_PROJECTS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryDocument {
    version: u32,
    project: Project,
    original_path: Option<String>,
    saved_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryDocumentRef<'a> {
    version: u32,
    project: &'a Project,
    original_path: Option<String>,
    saved_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub project_name: String,
    pub original_path: Option<String>,
    pub saved_at: DateTime<Utc>,
    pub component_count: usize,
    pub wire_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_at: DateTime<Utc>,
    #[serde(default = "default_exists")]
    pub exists: bool,
}

fn default_exists() -> bool {
    true
}

pub struct ReliabilityStore {
    data_dir: PathBuf,
}

impl ReliabilityStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    fn recovery_path(&self) -> PathBuf {
        self.data_dir.join("recovery.json")
    }

    fn recent_path(&self) -> PathBuf {
        self.data_dir.join("recent-projects.json")
    }

    pub fn save_recovery(
        &self,
        project: &Project,
        original_path: Option<&Path>,
    ) -> Result<RecoveryInfo, String> {
        let saved_at = Utc::now();
        let original_path = original_path.map(|path| path.display().to_string());
        let document = RecoveryDocumentRef {
            version: RECOVERY_VERSION,
            project,
            original_path: original_path.clone(),
            saved_at,
        };
        atomic_json(&self.recovery_path(), &document)?;
        Ok(RecoveryInfo {
            project_name: project.metadata.name.clone(),
            original_path,
            saved_at,
            component_count: project
                .sheets
                .iter()
                .map(|sheet| sheet.components.len())
                .sum(),
            wire_count: project.sheets.iter().map(|sheet| sheet.wires.len()).sum(),
        })
    }

    pub fn recovery_info(&self) -> Result<Option<RecoveryInfo>, String> {
        match self.read_recovery() {
            Ok(document) => Ok(document.as_ref().map(recovery_info)),
            Err(error) => {
                let quarantined = self.quarantine(&self.recovery_path(), "recovery")?;
                Err(format!(
                    "Invalid recovery data was moved to '{}': {error}",
                    quarantined.display()
                ))
            }
        }
    }

    pub fn load_recovery(&self) -> Result<Option<(Project, Option<PathBuf>)>, String> {
        self.read_recovery().map(|document| {
            document.map(|document| (document.project, document.original_path.map(PathBuf::from)))
        })
    }

    pub fn clear_recovery(&self) -> Result<(), String> {
        remove_if_present(&self.recovery_path())
    }

    pub fn recent_projects(&self) -> Result<Vec<RecentProject>, String> {
        let path = self.recent_path();
        let mut recent: Vec<RecentProject> = match read_json_or_default(&path) {
            Ok(recent) => recent,
            Err(_) => {
                self.quarantine(&path, "recent-projects")?;
                Vec::new()
            }
        };
        for entry in &mut recent {
            entry.exists = Path::new(&entry.path).is_file();
        }
        recent.truncate(MAX_RECENT_PROJECTS);
        Ok(recent)
    }

    pub fn remember_project(&self, path: &Path, name: &str) -> Result<(), String> {
        let path = path.display().to_string();
        let mut recent = self.recent_projects()?;
        recent.retain(|entry| entry.path != path);
        recent.insert(
            0,
            RecentProject {
                path,
                name: name.to_owned(),
                last_opened_at: Utc::now(),
                exists: true,
            },
        );
        recent.truncate(MAX_RECENT_PROJECTS);
        atomic_json(&self.recent_path(), &recent)
    }

    pub fn forget_project(&self, path: &Path) -> Result<Vec<RecentProject>, String> {
        let target = path.display().to_string();
        let mut recent = self.recent_projects()?;
        recent.retain(|entry| entry.path != target);
        atomic_json(&self.recent_path(), &recent)?;
        Ok(recent)
    }

    fn read_recovery(&self) -> Result<Option<RecoveryDocument>, String> {
        let path = self.recovery_path();
        if !path.exists() {
            return Ok(None);
        }
        let document: RecoveryDocument = read_json(&path)?;
        if document.version != RECOVERY_VERSION {
            return Err(format!("Unsupported recovery version {}", document.version));
        }
        crate::project::validate(&document.project).map_err(|error| error.to_string())?;
        if let Some(original_path) = document.original_path.as_deref() {
            if let Ok(saved_project) = crate::project::load(Path::new(original_path)) {
                if saved_project.updated_at >= document.project.updated_at {
                    self.clear_recovery()?;
                    return Ok(None);
                }
            }
        }
        Ok(Some(document))
    }

    fn quarantine(&self, path: &Path, stem: &str) -> Result<PathBuf, String> {
        let quarantined = self
            .data_dir
            .join(format!("{stem}.corrupt-{}.json", Utc::now().timestamp()));
        fs::rename(path, &quarantined).map_err(|error| error.to_string())?;
        Ok(quarantined)
    }
}

fn recovery_info(document: &RecoveryDocument) -> RecoveryInfo {
    RecoveryInfo {
        project_name: document.project.metadata.name.clone(),
        original_path: document.original_path.clone(),
        saved_at: document.saved_at,
        component_count: document
            .project
            .sheets
            .iter()
            .map(|sheet| sheet.components.len())
            .sum(),
        wire_count: document
            .project
            .sheets
            .iter()
            .map(|sheet| sheet.wires.len())
            .sum(),
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Reliability data path has no parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temp.write_all(&bytes).map_err(|error| error.to_string())?;
    temp.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temp.persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    if path.exists() {
        read_json(path)
    } else {
        Ok(T::default())
    }
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_round_trip_preserves_project_and_path() {
        let directory = tempfile::tempdir().unwrap();
        let store = ReliabilityStore::new(directory.path().to_path_buf());
        let project = Project::blank("Recovered amplifier");
        let original = directory.path().join("amplifier.sugeda");

        let info = store.save_recovery(&project, Some(&original)).unwrap();
        assert_eq!(info.project_name, "Recovered amplifier");
        let (restored, path) = store.load_recovery().unwrap().unwrap();
        assert_eq!(restored, project);
        assert_eq!(path.as_deref(), Some(original.as_path()));

        store.clear_recovery().unwrap();
        assert!(store.recovery_info().unwrap().is_none());
    }

    #[test]
    fn recent_projects_are_deduplicated_and_missing_files_are_retained() {
        let directory = tempfile::tempdir().unwrap();
        let store = ReliabilityStore::new(directory.path().to_path_buf());
        let project_path = directory.path().join("filter.sugeda");
        fs::write(&project_path, "placeholder").unwrap();

        store.remember_project(&project_path, "First name").unwrap();
        store.remember_project(&project_path, "Filter").unwrap();
        let recent = store.recent_projects().unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].name, "Filter");
        assert!(recent[0].exists);

        fs::remove_file(&project_path).unwrap();
        assert!(!store.recent_projects().unwrap()[0].exists);
    }

    #[test]
    fn recovery_older_than_the_saved_project_is_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let store = ReliabilityStore::new(directory.path().to_path_buf());
        let project_path = directory.path().join("saved.sugeda");
        let mut project = Project::blank("Saved");
        store.save_recovery(&project, Some(&project_path)).unwrap();
        project.updated_at = Utc::now() + chrono::Duration::seconds(1);
        crate::project::save(&project_path, &project).unwrap();

        assert!(store.recovery_info().unwrap().is_none());
        assert!(!store.recovery_path().exists());
    }

    #[test]
    fn corrupt_metadata_is_quarantined_instead_of_blocking_startup() {
        let directory = tempfile::tempdir().unwrap();
        let store = ReliabilityStore::new(directory.path().to_path_buf());
        fs::write(store.recent_path(), b"not json").unwrap();
        fs::write(store.recovery_path(), b"not json").unwrap();

        assert!(store.recent_projects().unwrap().is_empty());
        assert!(store.recovery_info().unwrap_err().contains("moved to"));
        assert!(!store.recent_path().exists());
        assert!(!store.recovery_path().exists());
    }
}
