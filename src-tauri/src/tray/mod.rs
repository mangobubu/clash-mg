use tauri::AppHandle;

pub fn setup_tray(_app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Tray menus are platform-specific enough to keep behind this module.
    Ok(())
}
