mod application;
mod domain;
mod export;
mod models;
mod netlist;
mod project;
mod simulation;

use application::{EditorCommand, Workspace, WorkspaceSnapshot};
use domain::Project;
use simulation::{BackendStatus, NgSpiceBackend, SimulationBackend, SimulationResult};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct AppState {
    workspace: Mutex<Workspace>,
    simulator: NgSpiceBackend,
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
    Ok(w.snapshot())
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
            app.manage(AppState {
                workspace: Mutex::new(Workspace::new(Project::blank("Untitled circuit"))),
                simulator: NgSpiceBackend::new(simulation::bundled_executable(&resource_dir)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            new_project,
            load_project,
            save_project,
            apply_editor_command,
            undo,
            redo,
            generate_netlist,
            import_spice_library,
            export_waveform,
            simulation_status,
            run_simulation,
            stop_simulation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
