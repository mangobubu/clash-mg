use std::fmt::Write;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod app_icon;
mod core;
mod core_log;
mod defaults;
mod mihomo;
mod models;
mod running_process;
mod storage;
mod subscription;
mod system_proxy;
mod tray;
mod tun_service;

use models::{
    AppSnapshot, ConnectionRefreshResult, DelayResult, LocalSubscriptionRefreshResult, ProxyNode,
    SettingsMap,
};

pub use tun_service::try_run_cli as try_run_tun_service_cli;

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

    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = close_window.hide() {
                eprintln!("隐藏连接窗口失败：{error}");
            }
        }
    });

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
    let previous = storage::load_snapshot(&app)?;
    let effective_config_changed =
        core::runtime_config_changed(&previous.settings, &snapshot.settings)
            || core::proxy_config_changed(&previous, &snapshot)
            || core::rule_config_changed(&previous, &snapshot);
    if effective_config_changed {
        core::sync_runtime_config(&app, &snapshot).await?;
    }
    let system_proxy_enabled = setting_bool(&snapshot.settings, "systemProxy", false);
    let system_proxy_changed =
        setting_bool(&previous.settings, "systemProxy", false) != system_proxy_enabled;
    let mixed_port_changed = setting_u16(&previous.settings, "mixedPort", 7890)
        != setting_u16(&snapshot.settings, "mixedPort", 7890);
    let system_proxy_requires_apply =
        system_proxy_changed || (system_proxy_enabled && mixed_port_changed);
    if system_proxy_requires_apply {
        system_proxy::apply(
            &app,
            system_proxy_enabled,
            setting_u16(&snapshot.settings, "mixedPort", 7890),
        )?;
    }
    if let Err(error) = storage::save_snapshot(&app, &snapshot) {
        let mut rollback_errors = Vec::new();
        if effective_config_changed {
            if let Err(rollback_error) = core::sync_runtime_config(&app, &previous).await {
                rollback_errors.push(format!("恢复运行配置失败：{rollback_error}"));
            }
        }
        if system_proxy_requires_apply {
            if let Err(rollback_error) = system_proxy::apply(
                &app,
                setting_bool(&previous.settings, "systemProxy", false),
                setting_u16(&previous.settings, "mixedPort", 7890),
            ) {
                rollback_errors.push(format!("恢复系统代理失败：{rollback_error}"));
            }
        }
        return Err(if rollback_errors.is_empty() {
            format!("保存应用状态失败：{error}；已恢复原运行状态")
        } else {
            format!("保存应用状态失败：{error}；{}", rollback_errors.join("；"))
        });
    }
    Ok(())
}

#[tauri::command]
async fn refresh_runtime_data(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
) -> Result<AppSnapshot, String> {
    let snapshot = subscription::enrich_runtime_nodes(&app, snapshot)?;
    let mut refreshed = mihomo::refresh_runtime_data(snapshot).await;
    core::merge_core_failure_logs(&app, &mut refreshed);
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn refresh_runtime_connections(
    settings: SettingsMap,
    nodes: Vec<ProxyNode>,
) -> Result<ConnectionRefreshResult, String> {
    mihomo::refresh_connections(settings, nodes).await
}

#[tauri::command]
async fn select_proxy_node(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    group_name: String,
    node_name: String,
) -> Result<AppSnapshot, String> {
    let refreshed = mihomo::select_proxy_node(snapshot, group_name, node_name).await?;
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
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
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
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
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn refresh_local_subscriptions(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    subscription_ids: Vec<String>,
) -> Result<LocalSubscriptionRefreshResult, String> {
    let refreshed =
        subscription::refresh_local_subscriptions(&app, snapshot, subscription_ids).await;
    storage::save_snapshot(&app, &refreshed.snapshot)?;
    Ok(refreshed)
}

#[tauri::command]
async fn delete_local_subscription(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
    subscription_id: String,
) -> Result<AppSnapshot, String> {
    let mut refreshed =
        subscription::delete_local_subscription(&app, snapshot, &subscription_id).await?;
    mihomo::push_runtime_log(
        &mut refreshed,
        "SUCCESS",
        "订阅",
        "已删除订阅及其关联代理组、节点和规则",
    );
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn test_proxy_delay(settings: SettingsMap, node_name: String) -> Result<DelayResult, String> {
    Ok(mihomo::test_proxy_delay(settings, node_name).await)
}

#[tauri::command]
fn get_mihomo_core_status(app: tauri::AppHandle) -> Result<core::MihomoCoreStatus, String> {
    core::core_status(&app)
}

#[tauri::command]
async fn download_mihomo_core(app: tauri::AppHandle) -> Result<core::MihomoCoreStatus, String> {
    core::download_core(app).await
}

#[tauri::command]
async fn start_mihomo_core(
    app: tauri::AppHandle,
    settings: SettingsMap,
) -> Result<core::MihomoCoreLaunchResult, String> {
    let mut snapshot = storage::load_snapshot(&app)?;
    snapshot.settings = settings;
    let result = core::start_core(app.clone(), snapshot.clone()).await?;
    if result.controller_ready {
        core::sync_runtime_config(&app, &snapshot).await?;
    }
    if result.controller_ready && setting_bool(&snapshot.settings, "systemProxy", false) {
        system_proxy::apply(
            &app,
            true,
            setting_u16(&snapshot.settings, "mixedPort", 7890),
        )?;
    }
    Ok(result)
}

#[tauri::command]
fn get_tun_service_status(app: tauri::AppHandle) -> Result<tun_service::TunServiceStatus, String> {
    tun_service::status(&app)
}

#[tauri::command]
async fn install_tun_service(
    app: tauri::AppHandle,
) -> Result<tun_service::TunServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || tun_service::install(&app))
        .await
        .map_err(|error| format!("安装 TUN 系统服务任务失败：{error}"))?
}

#[tauri::command]
async fn uninstall_tun_service(
    app: tauri::AppHandle,
) -> Result<tun_service::TunServiceStatus, String> {
    let mut snapshot = storage::load_snapshot(&app)?;
    if setting_bool(&snapshot.settings, "tunMode", false) {
        snapshot
            .settings
            .insert("tunMode".into(), serde_json::Value::Bool(false));
        let _ = core::sync_runtime_config(&app, &snapshot).await;
        storage::save_snapshot(&app, &snapshot)?;
    }
    tauri::async_runtime::spawn_blocking(move || tun_service::uninstall(&app))
        .await
        .map_err(|error| format!("删除 TUN 系统服务任务失败：{error}"))?
}

#[tauri::command]
async fn list_running_processes() -> Result<Vec<running_process::RunningProcess>, String> {
    tauri::async_runtime::spawn_blocking(running_process::list)
        .await
        .map_err(|error| format!("读取运行进程任务失败：{error}"))?
}

fn setting_bool(settings: &SettingsMap, key: &str, fallback: bool) -> bool {
    settings
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(fallback)
}

fn setting_u16(settings: &SettingsMap, key: &str, fallback: u16) -> u16 {
    settings
        .get(key)
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(fallback)
}

#[tauri::command]
fn get_lan_ip() -> String {
    use std::net::UdpSocket;
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                    return;
                };

                for (label, secondary_window) in window.app_handle().webview_windows() {
                    if label != "main" {
                        if let Err(error) = secondary_window.destroy() {
                            eprintln!("销毁子窗口“{label}”失败：{error}");
                        }
                    }
                }

                if tray::should_minimize_on_close(window.app_handle()) {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("隐藏主窗口失败：{error}");
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_connections_window,
            open_connection_detail_window,
            get_app_snapshot,
            save_app_snapshot,
            refresh_runtime_data,
            refresh_runtime_connections,
            select_proxy_node,
            close_runtime_connections,
            refresh_proxy_providers,
            refresh_local_subscriptions,
            delete_local_subscription,
            test_proxy_delay,
            get_mihomo_core_status,
            download_mihomo_core,
            start_mihomo_core,
            get_tun_service_status,
            install_tun_service,
            uninstall_tun_service,
            list_running_processes,
            get_lan_ip
        ])
        .run(tauri::generate_context!())
        .expect("运行 clash-mg 时发生错误");
}
