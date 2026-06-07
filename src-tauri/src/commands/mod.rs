use tauri::{AppHandle, State};

use crate::{
    config::{self, AppSettings, AppSettingsPatch, ProfileImportInput, ProfileSummary},
    core::CoreStatus,
    platform,
    proxy::{self, ConnectionSummary, CoreLog, ProxyGroup},
    storage::AppState,
};

type CommandResult<T> = Result<T, String>;

#[derive(serde::Serialize)]
pub struct AppStatus {
    app_version: String,
    platform: String,
    core: CoreStatus,
    active_profile: Option<ProfileSummary>,
    system_proxy_enabled: bool,
}

#[tauri::command]
pub fn get_app_status(app: AppHandle, state: State<AppState>) -> CommandResult<AppStatus> {
    let settings = state.settings()?;
    Ok(AppStatus {
        app_version: app.package_info().version.to_string(),
        platform: platform::current_platform().to_string(),
        core: state.core_status(),
        active_profile: state.active_profile()?,
        system_proxy_enabled: settings.system_proxy,
    })
}

#[tauri::command]
pub fn start_core(app: AppHandle, state: State<AppState>) -> CommandResult<CoreStatus> {
    state.start_core(&app)
}

#[tauri::command]
pub fn stop_core(state: State<AppState>) -> CommandResult<CoreStatus> {
    state.stop_core()
}

#[tauri::command]
pub fn restart_core(app: AppHandle, state: State<AppState>) -> CommandResult<CoreStatus> {
    let _ = state.stop_core();
    state.start_core(&app)
}

#[tauri::command]
pub fn list_profiles(state: State<AppState>) -> CommandResult<Vec<ProfileSummary>> {
    state.list_profiles()
}

#[tauri::command]
pub fn activate_profile(id: String, state: State<AppState>) -> CommandResult<ProfileSummary> {
    state.activate_profile(&id)
}

#[tauri::command]
pub fn import_profile(
    input: ProfileImportInput,
    state: State<AppState>,
) -> CommandResult<ProfileSummary> {
    state.import_profile(input)
}

#[tauri::command]
pub fn list_proxy_groups(state: State<AppState>) -> CommandResult<Vec<ProxyGroup>> {
    Ok(state.proxy_groups())
}

#[tauri::command]
pub fn select_proxy(
    group: String,
    proxy: String,
    state: State<AppState>,
) -> CommandResult<ProxyGroup> {
    state.select_proxy(&group, &proxy)
}

#[tauri::command]
pub fn list_connections() -> CommandResult<Vec<ConnectionSummary>> {
    Ok(proxy::sample_connections())
}

#[tauri::command]
pub fn close_connection(_id: String) -> CommandResult<()> {
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CommandResult<AppSettings> {
    state.settings()
}

#[tauri::command]
pub fn update_settings(
    patch: AppSettingsPatch,
    state: State<AppState>,
) -> CommandResult<AppSettings> {
    state.update_settings(patch)
}

#[tauri::command]
pub fn list_logs() -> CommandResult<Vec<CoreLog>> {
    Ok(proxy::sample_logs())
}

#[allow(dead_code)]
fn _load_runtime_config(app: &AppHandle) -> CommandResult<std::path::PathBuf> {
    config::runtime_config_path(app).map_err(|error| error.to_string())
}
