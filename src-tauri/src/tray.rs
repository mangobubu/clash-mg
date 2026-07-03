use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::{models::SettingsMap, storage};

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MAIN_WINDOW_MENU_ID: &str = "show-main-window";
const QUIT_APP_MENU_ID: &str = "quit-app";

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_main_window_item = MenuItem::with_id(
        app,
        SHOW_MAIN_WINDOW_MENU_ID,
        "显示主窗口",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_app = MenuItem::with_id(app, QUIT_APP_MENU_ID, "退出 Clash-MG", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_main_window_item, &separator, &quit_app])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Clash-MG")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MAIN_WINDOW_MENU_ID => show_main_window(app),
            QUIT_APP_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn should_minimize_on_close(app: &AppHandle) -> bool {
    storage::load_snapshot(app)
        .map(|snapshot| minimize_on_close_enabled(&snapshot.settings))
        .unwrap_or_else(|error| {
            eprintln!("读取关闭窗口行为设置失败，将默认最小化到托盘：{error}");
            true
        })
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("未找到主窗口，无法从系统托盘恢复");
        return;
    };

    if let Err(error) = window.unminimize() {
        eprintln!("恢复主窗口最小化状态失败：{error}");
    }
    if let Err(error) = window.show() {
        eprintln!("显示主窗口失败：{error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("聚焦主窗口失败：{error}");
    }
}

fn minimize_on_close_enabled(settings: &SettingsMap) -> bool {
    let tray_visible = settings
        .get("showTrayIcon")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    tray_visible
        && settings
        .get("minimizeOnClose")
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn minimizes_to_tray_when_setting_is_enabled() {
        let settings = SettingsMap::from([("minimizeOnClose".into(), json!(true))]);

        assert!(minimize_on_close_enabled(&settings));
    }

    #[test]
    fn exits_when_setting_is_disabled() {
        let settings = SettingsMap::from([("minimizeOnClose".into(), json!(false))]);

        assert!(!minimize_on_close_enabled(&settings));
    }

    #[test]
    fn defaults_to_minimizing_when_setting_is_missing_or_invalid() {
        let missing = SettingsMap::new();
        let invalid = SettingsMap::from([("minimizeOnClose".into(), json!("invalid"))]);

        assert!(minimize_on_close_enabled(&missing));
        assert!(minimize_on_close_enabled(&invalid));
    }
}
