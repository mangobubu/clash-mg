use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::{
    defaults::{default_snapshot, merge_default_settings},
    models::AppSnapshot,
};

const DATA_FILE_NAME: &str = "app-state.json";

fn data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join(DATA_FILE_NAME))
}

pub fn load_snapshot(app: &AppHandle) -> Result<AppSnapshot, String> {
    let path = data_file_path(app)?;

    if !path.exists() {
        return Ok(default_snapshot());
    }

    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut snapshot: AppSnapshot =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    merge_default_settings(&mut snapshot.settings);
    snapshot
        .subscriptions
        .retain(|subscription| !subscription.is_runtime_provider_record());
    Ok(snapshot)
}

pub fn save_snapshot(app: &AppHandle, snapshot: &AppSnapshot) -> Result<(), String> {
    let path = data_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(snapshot).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}
