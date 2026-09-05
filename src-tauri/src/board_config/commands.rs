use super::{
    build_from_draft, export_configuration, validate_draft, BoardConfigurationExportFormat,
    BoardConfigurationExportReceipt,
};
use crate::{
    application::WorkspaceSnapshot, device_config::DeviceConfig, device_config::DeviceConfigReport,
    AppState,
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub(crate) fn validate_board_configuration_draft(
    logical_instance_id: String,
    config: DeviceConfig,
    state: State<'_, AppState>,
) -> Result<DeviceConfigReport, String> {
    let instance_id = uuid::Uuid::parse_str(&logical_instance_id)
        .map_err(|_| "Logical device instance id is invalid".to_owned())?;
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    validate_draft(&workspace.project, instance_id, &config)
}

#[tauri::command]
pub(crate) fn apply_board_configuration_draft(
    logical_instance_id: String,
    config: DeviceConfig,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let instance_id = uuid::Uuid::parse_str(&logical_instance_id)
        .map_err(|_| "Logical device instance id is invalid".to_owned())?;
    let mut workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    let configuration = build_from_draft(&workspace.project, instance_id, config)?;
    workspace.upsert_board_configuration(configuration)?;
    Ok(workspace.snapshot())
}

#[tauri::command]
pub(crate) fn export_board_configuration(
    configuration_id: String,
    path: String,
    format: BoardConfigurationExportFormat,
    state: State<'_, AppState>,
) -> Result<BoardConfigurationExportReceipt, String> {
    let configuration_id = uuid::Uuid::parse_str(&configuration_id)
        .map_err(|_| "Board configuration id is invalid".to_owned())?;
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| "Workspace lock was poisoned".to_owned())?;
    export_configuration(
        &workspace.project,
        configuration_id,
        &PathBuf::from(path),
        format,
    )
}
