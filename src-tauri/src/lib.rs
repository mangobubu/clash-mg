mod commands;
mod config;
mod core;
mod platform;
mod proxy;
mod storage;
mod tray;

use commands::{
    activate_profile, close_connection, get_app_status, get_settings, import_profile,
    list_connections, list_logs, list_profiles, list_proxy_groups, restart_core, select_proxy,
    start_core, stop_core, update_settings,
};
use core::CoreManager;
use storage::AppState;

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new(CoreManager::default()))
        .setup(|app| {
            storage::ensure_app_dirs(app.handle())?;
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            start_core,
            stop_core,
            restart_core,
            list_profiles,
            activate_profile,
            import_profile,
            list_proxy_groups,
            select_proxy,
            list_connections,
            close_connection,
            get_settings,
            update_settings,
            list_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
