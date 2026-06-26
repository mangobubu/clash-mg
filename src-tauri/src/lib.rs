use std::fmt::Write;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod defaults;
mod mihomo;
mod models;
mod storage;

use models::{AppSnapshot, DelayResult, SettingsMap};

const CONNECTIONS_WINDOW_LABEL: &str = "connections-window";

fn create_connection_window_label(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect();

    format!("connection-detail-{sanitized}")
}

fn encode_route_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            let _ = write!(&mut encoded, "%{byte:02X}");
        }
    }

    encoded
}

#[tauri::command]
async fn open_connections_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CONNECTIONS_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App("index.html#/connections-window".into());
    let window = WebviewWindowBuilder::new(&app, CONNECTIONS_WINDOW_LABEL, url)
        .title("连接")
        .inner_size(1180.0, 760.0)
        .min_inner_size(920.0, 600.0)
        .center()
        .decorations(true)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn open_connection_detail_window(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<(), String> {
    let label = create_connection_window_label(&id);

    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let encoded_id = encode_route_segment(&id);
    let url = WebviewUrl::App(format!("index.html#/connection-detail/{encoded_id}").into());

    WebviewWindowBuilder::new(&app, label, url)
        .title(title)
        .inner_size(720.0, 680.0)
        .min_inner_size(560.0, 520.0)
        .center()
        .decorations(true)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_app_snapshot(app: tauri::AppHandle) -> Result<AppSnapshot, String> {
    storage::load_snapshot(&app)
}

#[tauri::command]
async fn save_app_snapshot(app: tauri::AppHandle, snapshot: AppSnapshot) -> Result<(), String> {
    storage::save_snapshot(&app, &snapshot)
}

#[tauri::command]
async fn refresh_runtime_data(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
) -> Result<AppSnapshot, String> {
    let refreshed = mihomo::refresh_runtime_data(snapshot).await;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn select_proxy_node(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    group_name: String,
    node_name: String,
) -> Result<AppSnapshot, String> {
    let refreshed = mihomo::select_proxy_node(snapshot, group_name, node_name).await?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn close_runtime_connections(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    ids: Vec<String>,
) -> Result<AppSnapshot, String> {
    let refreshed = mihomo::close_connections(snapshot, ids).await?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn refresh_proxy_providers(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    provider_names: Vec<String>,
) -> Result<AppSnapshot, String> {
    let refreshed = mihomo::refresh_proxy_providers(snapshot, provider_names).await?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn test_proxy_delay(settings: SettingsMap, node_name: String) -> Result<DelayResult, String> {
    Ok(mihomo::test_proxy_delay(settings, node_name).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_connections_window,
            open_connection_detail_window,
            get_app_snapshot,
            save_app_snapshot,
            refresh_runtime_data,
            select_proxy_node,
            close_runtime_connections,
            refresh_proxy_providers,
            test_proxy_delay
        ])
        .run(tauri::generate_context!())
        .expect("运行 clash-mg 时发生错误");
}
