mod application;
mod device_instance;
mod device_pack;
mod domain;
mod erc;
mod export;
mod models;
mod netlist;
mod project;
mod reliability;
mod sdk_adapter;
mod simulation;
mod simulation_binding;

use application::{EditorCommand, Workspace, WorkspaceSnapshot};
use domain::Project;
use simulation::{BackendStatus, NgSpiceBackend, SimulationBackend, SimulationResult};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct AppState {
    workspace: Mutex<Workspace>,
    simulator: NgSpiceBackend,
    reliability: reliability::ReliabilityStore,
}

#[tauri::command]
fn workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())
        .map(|w| w.snapshot())
}
#[tauri::command]
fn new_project(
    name: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    state.reliability.clear_recovery()?;
    w.replace(
        Project::blank(name.as_deref().unwrap_or("Untitled circuit")),
        None,
    );
    Ok(w.snapshot())
}
#[tauri::command]
fn load_project(path: String, state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    let path = PathBuf::from(path);
    let loaded = project::load(&path).map_err(|e| e.to_string())?;
    state.reliability.clear_recovery()?;
    let _ = state
        .reliability
        .remember_project(&path, &loaded.metadata.name);
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    w.replace(loaded, Some(path));
    Ok(w.snapshot())
}
#[tauri::command]
fn save_project(
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    let resolved = path
        .map(PathBuf::from)
        .or_else(|| w.path.clone())
        .ok_or_else(|| "Choose a .sugeda file with Save As".to_owned())?;
    w.project.updated_at = chrono::Utc::now();
    project::save(&resolved, &w.project).map_err(|e| e.to_string())?;
    w.mark_saved(resolved);
    let saved_path = w.path.as_deref().expect("saved project has a path");
    let _ = state
        .reliability
        .remember_project(saved_path, &w.project.metadata.name);
    let _ = state.reliability.clear_recovery();
    Ok(w.snapshot())
}

#[tauri::command]
fn autosave_project(
    state: State<'_, AppState>,
) -> Result<Option<reliability::RecoveryInfo>, String> {
    let w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    if !w.is_dirty() {
        return Ok(None);
    }
    state
        .reliability
        .save_recovery(&w.project, w.path.as_deref())
        .map(Some)
}

#[tauri::command]
fn recovery_status(
    state: State<'_, AppState>,
) -> Result<Option<reliability::RecoveryInfo>, String> {
    state.reliability.recovery_info()
}

#[tauri::command]
fn restore_recovery(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    let (project, path) = state
        .reliability
        .load_recovery()?
        .ok_or_else(|| "No recovery snapshot is available".to_owned())?;
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    w.restore(project, path);
    Ok(w.snapshot())
}

#[tauri::command]
fn discard_recovery(state: State<'_, AppState>) -> Result<(), String> {
    state.reliability.clear_recovery()
}

#[tauri::command]
fn recent_projects(state: State<'_, AppState>) -> Result<Vec<reliability::RecentProject>, String> {
    state.reliability.recent_projects()
}

#[tauri::command]
fn forget_recent_project(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<reliability::RecentProject>, String> {
    state.reliability.forget_project(&PathBuf::from(path))
}
#[tauri::command]
fn apply_editor_command(
    command: EditorCommand,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    w.apply(command)?;
    Ok(w.snapshot())
}
#[tauri::command]
fn undo(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    w.undo();
    Ok(w.snapshot())
}
#[tauri::command]
fn redo(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, String> {
    let mut w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    w.redo();
    Ok(w.snapshot())
}
#[tauri::command]
fn generate_netlist(state: State<'_, AppState>) -> Result<String, Vec<netlist::NetlistError>> {
    let w = state.workspace.lock().map_err(|_| {
        vec![netlist::NetlistError {
            code: "internal",
            message: "Workspace lock was poisoned".into(),
            component_id: None,
        }]
    })?;
    netlist::generate(&w.project)
}
#[tauri::command]
fn simulation_check(state: State<'_, AppState>) -> Result<netlist::SimulationCheckReport, String> {
    let w = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    Ok(netlist::check(&w.project))
}
#[tauri::command]
fn import_spice_library(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let library = models::import(&PathBuf::from(path)).map_err(|error| error.to_string())?;
    let mut workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    workspace.add_spice_library(library)?;
    Ok(workspace.snapshot())
}

#[tauri::command]
fn import_device_pack(
    path: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let pack = device_pack::import(&PathBuf::from(path)).map_err(|error| error.to_string())?;
    let libraries =
        device_pack::embedded_spice_libraries(&pack).map_err(|error| error.to_string())?;
    let mut workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    workspace.add_device_pack(pack, libraries)?;
    Ok(workspace.snapshot())
}

#[tauri::command]
fn run_erc(state: State<'_, AppState>) -> Result<crate::erc::ErcReport, String> {
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    Ok(crate::erc::check(&workspace.project))
}
#[tauri::command]
fn inspect_sdk_adapter(
    pack_sha256: String,
    adapter_id: String,
    root_path: String,
    state: State<'_, AppState>,
) -> Result<sdk_adapter::SdkAdapterReport, String> {
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    sdk_adapter::inspect(
        &workspace.project,
        &pack_sha256,
        &adapter_id,
        &PathBuf::from(root_path),
    )
}
#[tauri::command]
fn simulation_status(configured_path: Option<String>, state: State<'_, AppState>) -> BackendStatus {
    state.simulator.status(configured_path.as_deref())
}
#[tauri::command]
fn export_waveform(path: String, csv: String) -> Result<(), String> {
    export::csv(&PathBuf::from(path), &csv)
}
#[tauri::command]
async fn run_simulation(
    configured_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<SimulationResult, String> {
    let (netlist, analysis, signals) = {
        let w = state
            .workspace
            .lock()
            .map_err(|_| "Workspace lock was poisoned".to_owned())?;
        (
            netlist::generate(&w.project).map_err(|errors| {
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("\n")
            })?,
            w.active_analysis()
                .ok_or_else(|| "No active simulation profile".to_owned())?,
            w.project
                .simulation_profiles
                .iter()
                .find(|profile| Some(profile.id) == w.project.active_simulation_profile)
                .map(|profile| profile.signals.clone())
                .unwrap_or_default(),
        )
    };
    let backend = state.simulator.clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend
            .run(&netlist, &analysis, &signals, configured_path.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn stop_simulation(state: State<'_, AppState>) -> Result<(), String> {
    state.simulator.cancel().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                workspace: Mutex::new(Workspace::new(Project::blank("Untitled circuit"))),
                simulator: NgSpiceBackend::new(simulation::bundled_executable(&resource_dir)),
                reliability: reliability::ReliabilityStore::new(app_data_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            new_project,
            load_project,
            save_project,
            autosave_project,
            recovery_status,
            restore_recovery,
            discard_recovery,
            recent_projects,
            forget_recent_project,
            apply_editor_command,
            undo,
            redo,
            generate_netlist,
            simulation_check,
            import_spice_library,
            import_device_pack,
            run_erc,
            inspect_sdk_adapter,
            export_waveform,
            simulation_status,
            run_simulation,
            stop_simulation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
