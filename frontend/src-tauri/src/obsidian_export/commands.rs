use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tracing::info;

use crate::obsidian_export::parser::ObsidianExportResult;
use crate::obsidian_export::service::{export_meeting_to_obsidian, open_folder_in_explorer};
use crate::state::AppState;

#[tauri::command]
pub async fn select_obsidian_vault_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    info!("Opening folder picker for Obsidian vault");

    let folder = app.dialog().file().blocking_pick_folder();

    if let Some(path) = folder {
        let path_str = path.to_string();
        info!("Selected Obsidian vault folder: {}", path_str);
        Ok(Some(path_str))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn export_meeting_to_obsidian_command<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
    vault_path: String,
    user_prompt: String,
) -> Result<ObsidianExportResult, String> {
    let pool = state.db_manager.pool();
    export_meeting_to_obsidian(&app, pool, &meeting_id, &vault_path, &user_prompt).await
}

#[tauri::command]
pub async fn open_folder_path(folder_path: String) -> Result<(), String> {
    open_folder_in_explorer(&folder_path)
}
