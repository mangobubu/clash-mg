use std::{
    collections::HashMap,
    fmt::Write,
    sync::{
        atomic::{AtomicU8, Ordering},
        Mutex,
    },
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod app_icon;
mod app_update;
mod autostart;
mod core;
mod core_log;
mod defaults;
mod firewall;
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
const EXIT_IDLE: u8 = 0;
const EXIT_STOPPING_MIHOMO: u8 = 1;
const EXIT_READY: u8 = 2;
const EXIT_CLEANUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Default)]
struct ConnectionDetailSnapshots(Mutex<HashMap<String, models::Connection>>);

#[derive(Default)]
struct AppExitState(AtomicU8);

#[derive(Default)]
struct AppMutationState(tokio::sync::Mutex<()>);

#[derive(Default)]
struct AppliedSaveEffects {
    core: bool,
    system_proxy: bool,
    autostart: bool,
    firewall: bool,
}

impl AppExitState {
    fn is_ready(&self) -> bool {
        self.0.load(Ordering::Acquire) == EXIT_READY
    }

    fn begin_cleanup(&self) -> bool {
        self.0
            .compare_exchange(
                EXIT_IDLE,
                EXIT_STOPPING_MIHOMO,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn mark_ready(&self) {
        self.0.store(EXIT_READY, Ordering::Release);
    }
}

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
        .inner_size(1480.0, 860.0)
        .min_inner_size(1100.0, 680.0)
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
    connection: models::Connection,
    title: String,
) -> Result<(), String> {
    let id = connection.id.clone();
    app.state::<ConnectionDetailSnapshots>()
        .0
        .lock()
        .map_err(|_| "连接详情缓存不可用".to_string())?
        .insert(id.clone(), connection);

    let label = create_connection_window_label(&id);

    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let encoded_id = encode_route_segment(&id);
    let url = WebviewUrl::App(format!("index.html#/connection-detail/{encoded_id}").into());

    let window = WebviewWindowBuilder::new(&app, label, url)
        .title(title)
        .inner_size(720.0, 680.0)
        .min_inner_size(560.0, 520.0)
        .center()
        .decorations(true)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|error| error.to_string())?;

    let detail_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut snapshots) = detail_app.state::<ConnectionDetailSnapshots>().0.lock() {
                snapshots.remove(&id);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn get_connection_detail_snapshot(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<models::Connection>, String> {
    app.state::<ConnectionDetailSnapshots>()
        .0
        .lock()
        .map_err(|_| "连接详情缓存不可用".to_string())
        .map(|snapshots| snapshots.get(&id).cloned())
}

#[tauri::command]
async fn get_app_snapshot(app: tauri::AppHandle) -> Result<AppSnapshot, String> {
    storage::load_snapshot(&app)
}

#[tauri::command]
async fn save_app_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    snapshot: AppSnapshot,
) -> Result<(), String> {
    let _guard = state.0.lock().await;
    save_app_snapshot_locked(&app, snapshot).await
}

async fn save_app_snapshot_locked(
    app: &tauri::AppHandle,
    mut snapshot: AppSnapshot,
) -> Result<(), String> {
    let previous = storage::load_snapshot(app)?;
    merge_newer_subscription_runtime(&previous, &mut snapshot);
    let effective_config_changed =
        core::runtime_config_changed(&previous.settings, &snapshot.settings)
            || core::proxy_config_changed(&previous, &snapshot)
            || core::rule_config_changed(&previous, &snapshot)
            || core::override_config_changed(&previous, &snapshot)
            || core::subscription_config_changed(&previous, &snapshot);
    let mut applied = AppliedSaveEffects::default();
    if effective_config_changed {
        applied.core = true;
        if let Err(error) = core::sync_runtime_config(app, &snapshot).await {
            return Err(rollback_save_effects(
                app,
                &previous,
                applied,
                format!("应用运行配置失败：{error}"),
            )
            .await);
        }
    }

    let system_proxy_enabled = setting_bool(&snapshot.settings, "systemProxy", false);
    let system_proxy_changed =
        setting_bool(&previous.settings, "systemProxy", false) != system_proxy_enabled;
    let mixed_port_changed = setting_u16(&previous.settings, "mixedPort", 7890)
        != setting_u16(&snapshot.settings, "mixedPort", 7890);
    let system_proxy_requires_apply =
        system_proxy_changed || (system_proxy_enabled && mixed_port_changed);
    if system_proxy_requires_apply {
        applied.system_proxy = true;
        if let Err(error) = system_proxy::apply(
            app,
            system_proxy_enabled,
            setting_u16(&snapshot.settings, "mixedPort", 7890),
        ) {
            return Err(rollback_save_effects(
                app,
                &previous,
                applied,
                format!("应用系统代理失败：{error}"),
            )
            .await);
        }
    }

    let autostart_enabled = setting_bool(&snapshot.settings, "launchAtStartup", false);
    let autostart_changed =
        setting_bool(&previous.settings, "launchAtStartup", false) != autostart_enabled;
    if autostart_changed {
        applied.autostart = true;
        if let Err(error) = autostart::apply(app, autostart_enabled) {
            return Err(rollback_save_effects(
                app,
                &previous,
                applied,
                format!("应用开机启动设置失败：{error}"),
            )
            .await);
        }
    }

    let firewall_enabled = setting_bool(&snapshot.settings, "firewall", false);
    let firewall_changed = setting_bool(&previous.settings, "firewall", false) != firewall_enabled
        || (firewall_enabled
            && ["mixedPort", "httpPort", "socksPort"]
                .iter()
                .any(|key| previous.settings.get(*key) != snapshot.settings.get(*key)));
    if firewall_changed {
        if let Err(error) = firewall::apply(&snapshot.settings, firewall_enabled) {
            applied.firewall = true;
            return Err(rollback_save_effects(
                app,
                &previous,
                applied,
                format!("应用防火墙设置失败：{error}"),
            )
            .await);
        }
        applied.firewall = true;
    }

    if let Err(error) = storage::save_snapshot(app, &snapshot) {
        return Err(rollback_save_effects(
            app,
            &previous,
            applied,
            format!("保存应用状态失败：{error}"),
        )
        .await);
    }
    Ok(())
}

fn merge_newer_subscription_runtime(previous: &AppSnapshot, incoming: &mut AppSnapshot) {
    for subscription in &previous.subscriptions {
        let Some(target) = incoming
            .subscriptions
            .iter_mut()
            .find(|item| item.id == subscription.id)
        else {
            continue;
        };
        if subscription.last_updated_at > target.last_updated_at {
            target.node_count = subscription.node_count;
            target.last_updated = subscription.last_updated.clone();
            target.last_updated_at = subscription.last_updated_at;
            target.status = subscription.status.clone();
            target.used_traffic = subscription.used_traffic.clone();
            target.expires_at = subscription.expires_at.clone();
        }
    }
}

async fn rollback_save_effects(
    app: &tauri::AppHandle,
    previous: &AppSnapshot,
    applied: AppliedSaveEffects,
    original_error: String,
) -> String {
    let mut errors = Vec::new();
    let mut rollback_attempted = false;
    if applied.firewall {
        rollback_attempted = true;
        if let Err(error) = firewall::apply(
            &previous.settings,
            setting_bool(&previous.settings, "firewall", false),
        ) {
            errors.push(format!("恢复防火墙失败：{error}"));
        }
    }
    if applied.autostart {
        rollback_attempted = true;
        if let Err(error) = autostart::apply(
            app,
            setting_bool(&previous.settings, "launchAtStartup", false),
        ) {
            errors.push(format!("恢复开机启动设置失败：{error}"));
        }
    }
    if applied.system_proxy {
        rollback_attempted = true;
        if let Err(error) = system_proxy::apply(
            app,
            setting_bool(&previous.settings, "systemProxy", false),
            setting_u16(&previous.settings, "mixedPort", 7890),
        ) {
            errors.push(format!("恢复系统代理失败：{error}"));
        }
    }
    let runtime_rollback_blocked = applied.core
        && tun_service::status(app)
            .is_ok_and(|status| service_status_blocks_runtime_rollback(&status));
    if applied.core && !runtime_rollback_blocked {
        rollback_attempted = true;
        if let Err(error) = core::sync_runtime_config(app, previous).await {
            errors.push(format!("恢复运行配置失败：{error}"));
        }
    }
    if !errors.is_empty() {
        format!("{original_error}；{}", errors.join("；"))
    } else if rollback_attempted {
        format!("{original_error}；已恢复原运行状态")
    } else {
        original_error
    }
}

fn service_status_blocks_runtime_rollback(status: &tun_service::TunServiceStatus) -> bool {
    status.installed && (!status.version_compatible || status.message.is_some())
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<app_update::AppUpdateInfo, String> {
    app_update::check(app).await
}

#[tauri::command]
async fn refresh_runtime_data(
    app: tauri::AppHandle,
    snapshot: AppSnapshot,
) -> Result<AppSnapshot, String> {
    let snapshot = subscription::enrich_runtime_nodes(&app, snapshot)?;
    let mut refreshed = mihomo::refresh_runtime_data(snapshot).await;
    core::merge_core_failure_logs(&app, &mut refreshed);
    subscription::enrich_runtime_nodes(&app, refreshed)
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
    state: tauri::State<'_, AppMutationState>,
    _snapshot: AppSnapshot,
    group_name: String,
    node_name: String,
) -> Result<AppSnapshot, String> {
    let _guard = state.0.lock().await;
    // 获锁后从磁盘加载最新快照，避免覆盖后台自动更新写入的订阅运行时数据
    let latest = storage::load_snapshot(&app)?;
    let refreshed = mihomo::select_proxy_node(latest, group_name, node_name).await?;
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn close_runtime_connections(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    ids: Vec<String>,
) -> Result<AppSnapshot, String> {
    let _guard = state.0.lock().await;
    let snapshot = storage::load_snapshot(&app)?;
    let refreshed = mihomo::close_connections(snapshot, ids).await?;
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn refresh_proxy_providers(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    _snapshot: AppSnapshot,
    provider_names: Vec<String>,
) -> Result<AppSnapshot, String> {
    let _guard = state.0.lock().await;
    // 获锁后从磁盘加载最新快照，避免覆盖后台自动更新写入的订阅运行时数据
    let latest = storage::load_snapshot(&app)?;
    let refreshed = mihomo::refresh_proxy_providers(latest, provider_names).await?;
    let refreshed = subscription::enrich_runtime_nodes(&app, refreshed)?;
    storage::save_snapshot(&app, &refreshed)?;
    Ok(refreshed)
}

#[tauri::command]
async fn refresh_local_subscriptions(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    snapshot: AppSnapshot,
    subscription_ids: Vec<String>,
) -> Result<LocalSubscriptionRefreshResult, String> {
    let mut refreshed =
        subscription::refresh_local_subscriptions(&app, snapshot, subscription_ids).await;

    let _guard = state.0.lock().await;
    let mut latest = storage::load_snapshot(&app)?;
    merge_newer_subscription_runtime(&refreshed.snapshot, &mut latest);
    storage::save_snapshot(&app, &latest)?;

    refreshed.snapshot = latest;
    Ok(refreshed)
}

#[tauri::command]
async fn delete_local_subscription(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    snapshot: AppSnapshot,
    subscription_id: String,
) -> Result<AppSnapshot, String> {
    let _guard = state.0.lock().await;
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
async fn start_mihomo_core(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
    settings: SettingsMap,
) -> Result<core::MihomoCoreLaunchResult, String> {
    let _guard = state.0.lock().await;
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
    state: tauri::State<'_, AppMutationState>,
) -> Result<tun_service::TunServiceStatus, String> {
    let _guard = state.0.lock().await;
    let snapshot = storage::load_snapshot(&app)?;
    let install_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || tun_service::install(&install_app))
        .await
        .map_err(|error| format!("安装 Mihomo 系统服务任务失败：{error}"))??;
    core::start_core(app.clone(), snapshot).await?;
    tun_service::status(&app)
}

#[tauri::command]
async fn uninstall_tun_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppMutationState>,
) -> Result<tun_service::TunServiceStatus, String> {
    let _guard = state.0.lock().await;
    let mut snapshot = storage::load_snapshot(&app)?;
    if setting_bool(&snapshot.settings, "tunMode", false) {
        snapshot
            .settings
            .insert("tunMode".into(), serde_json::Value::Bool(false));
        let _ = core::sync_runtime_config(&app, &snapshot).await;
        storage::save_snapshot(&app, &snapshot)?;
    }
    let uninstall_app = app.clone();
    let status =
        tauri::async_runtime::spawn_blocking(move || tun_service::uninstall(&uninstall_app))
            .await
            .map_err(|error| format!("删除 Mihomo 系统服务任务失败：{error}"))??;
    core::start_core(app, snapshot).await?;
    Ok(status)
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

async fn stop_mihomo_before_exit(app: &tauri::AppHandle) -> Result<(), String> {
    let settings = storage::load_snapshot(app)
        .map(|snapshot| snapshot.settings)
        .unwrap_or_else(|error| {
            eprintln!("退出时读取应用设置失败，将仅按进程记录停止 Mihomo：{error}");
            SettingsMap::new()
        });
    let managed_result = core::stop_managed_core_on_exit(app, &settings).await;

    let service_app = app.clone();
    let service_result =
        tauri::async_runtime::spawn_blocking(move || tun_service::stop_core(&service_app))
            .await
            .map_err(|error| format!("停止系统服务托管的 Mihomo 任务失败：{error}"))?;

    match (service_result, managed_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(service_error), Err(managed_error)) => Err(format!(
            "停止系统服务托管的 Mihomo 失败：{service_error}；停止应用托管的 Mihomo 失败：{managed_error}"
        )),
    }
}

async fn refresh_due_subscriptions(
    app: &tauri::AppHandle,
    state: &AppMutationState,
) -> Result<usize, String> {
    // 阶段一（无锁）：读快照、筛选到期订阅、执行网络下载（每条超时最多 20 秒）
    let snapshot = storage::load_snapshot(app)?;
    let now = chrono::Local::now().timestamp();
    let due_ids = snapshot
        .subscriptions
        .iter()
        .filter(|item| subscription_is_due(item, now))
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    if due_ids.is_empty() {
        return Ok(0);
    }
    let refreshed = subscription::refresh_local_subscriptions(app, snapshot, due_ids).await;
    let updated = refreshed.updated;
    if updated == 0 {
        return Ok(0);
    }
    // 阶段二（持锁）：重新加载磁盘最新快照，合并下载结果后保存
    // 使用 merge_newer_subscription_runtime 处理下载期间其他写操作造成的版本冲突
    let _guard = state.0.lock().await;
    let mut latest = storage::load_snapshot(app)?;
    merge_newer_subscription_runtime(&refreshed.snapshot, &mut latest);
    storage::save_snapshot(app, &latest)?;
    Ok(updated)
}

fn subscription_is_due(subscription: &models::Subscription, now: i64) -> bool {
    subscription.enabled
        && subscription.auto_update
        && subscription.subscription_type == "HTTP"
        && subscription.update_interval > 0
        && subscription.last_updated_at.is_none_or(|updated_at| {
            now.saturating_sub(updated_at) >= i64::from(subscription.update_interval) * 3600
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ConnectionDetailSnapshots::default())
        .manage(AppExitState::default())
        .manage(AppMutationState::default())
        .setup(|app| {
            let snapshot = storage::load_snapshot(app.handle()).unwrap_or_else(|error| {
                eprintln!("读取启动设置失败，将使用默认设置：{error}");
                defaults::default_snapshot()
            });
            let tray_visible = setting_bool(&snapshot.settings, "showTrayIcon", true);
            if tray_visible {
                tray::setup(app.handle())?;
            }
            if let Err(error) = autostart::apply(
                app.handle(),
                setting_bool(&snapshot.settings, "launchAtStartup", false),
            ) {
                eprintln!("同步开机启动设置失败：{error}");
            }
            if !setting_bool(&snapshot.settings, "silentLaunch", false) || !tray_visible {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                    window.set_focus()?;
                }
            }
            let monitor_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let Ok(snapshot) = storage::load_snapshot(&monitor_app) else {
                        continue;
                    };
                    match mihomo::enforce_runtime_connection_limit(snapshot.settings).await {
                        Ok(closed) if closed > 0 => {
                            eprintln!("连接数超过并发限制，已关闭 {closed} 条最新连接");
                        }
                        Ok(_) => {}
                        Err(_) => {}
                    }
                }
            });
            let subscription_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    let state = subscription_app.state::<AppMutationState>();
                    // 锁已移入 refresh_due_subscriptions 内部，仅在提交阶段持锁
                    if let Err(error) = refresh_due_subscriptions(&subscription_app, &state).await {
                        eprintln!("自动更新订阅失败：{error}");
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                    return;
                };

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
            get_connection_detail_snapshot,
            get_app_snapshot,
            save_app_snapshot,
            check_app_update,
            refresh_runtime_data,
            refresh_runtime_connections,
            select_proxy_node,
            close_runtime_connections,
            refresh_proxy_providers,
            refresh_local_subscriptions,
            delete_local_subscription,
            test_proxy_delay,
            start_mihomo_core,
            get_tun_service_status,
            install_tun_service,
            uninstall_tun_service,
            list_running_processes,
            get_lan_ip
        ])
        .build(tauri::generate_context!())
        .expect("构建 clash-mg 应用失败");

    app.run(|app, event| {
        let tauri::RunEvent::ExitRequested { code, api, .. } = event else {
            return;
        };
        let exit_state = app.state::<AppExitState>();
        if exit_state.is_ready() {
            return;
        }

        api.prevent_exit();
        if !exit_state.begin_cleanup() {
            return;
        }

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            match tokio::time::timeout(EXIT_CLEANUP_TIMEOUT, stop_mihomo_before_exit(&app)).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("应用退出时停止 Mihomo 失败：{error}"),
                Err(_) => eprintln!("应用退出时停止 Mihomo 超时，将继续退出"),
            }
            app.state::<AppExitState>().mark_ready();
            app.exit(code.unwrap_or(0));
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_subscription() -> models::Subscription {
        models::Subscription {
            id: "subscription".into(),
            name: "测试订阅".into(),
            subscription_type: "HTTP".into(),
            url: "https://example.com/sub".into(),
            node_count: 0,
            last_updated: "尚未更新".into(),
            update_interval: 12,
            status: "正常".into(),
            enabled: true,
            auto_update: true,
            proxy_update: true,
            allow_override: false,
            user_agent: None,
            headers: HashMap::new(),
            health_check: true,
            test_url: "https://www.gstatic.com/generate_204".into(),
            last_updated_at: None,
            description: None,
            used_traffic: "0 B".into(),
            expires_at: "未知".into(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn exit_cleanup_only_starts_once_and_allows_exit_after_completion() {
        let state = AppExitState::default();

        assert!(!state.is_ready());
        assert!(state.begin_cleanup());
        assert!(!state.begin_cleanup());

        state.mark_ready();

        assert!(state.is_ready());
    }

    #[test]
    fn schedules_only_due_enabled_http_subscriptions() {
        let mut subscription = test_subscription();
        assert!(subscription_is_due(&subscription, 100_000));

        subscription.last_updated_at = Some(100_000 - 11 * 3600);
        assert!(!subscription_is_due(&subscription, 100_000));
        subscription.last_updated_at = Some(100_000 - 12 * 3600);
        assert!(subscription_is_due(&subscription, 100_000));

        subscription.auto_update = false;
        assert!(!subscription_is_due(&subscription, 100_000));
    }

    #[test]
    fn preserves_newer_backend_subscription_results_during_stale_save() {
        let mut previous = defaults::default_snapshot();
        let mut refreshed = test_subscription();
        refreshed.node_count = 8;
        refreshed.last_updated = "12:00:00".into();
        refreshed.last_updated_at = Some(200);
        previous.subscriptions.push(refreshed);

        let mut incoming = defaults::default_snapshot();
        let mut stale = test_subscription();
        stale.last_updated_at = Some(100);
        incoming.subscriptions.push(stale);
        merge_newer_subscription_runtime(&previous, &mut incoming);

        assert_eq!(incoming.subscriptions[0].node_count, 8);
        assert_eq!(incoming.subscriptions[0].last_updated_at, Some(200));
    }

    #[test]
    fn skips_runtime_rollback_when_installed_service_is_unavailable() {
        let incompatible = tun_service::TunServiceStatus {
            installed: true,
            running: true,
            version_compatible: false,
            service_version: Some("旧版本".into()),
            message: Some("系统服务版本与应用不一致".into()),
        };
        let available = tun_service::TunServiceStatus {
            installed: true,
            running: true,
            version_compatible: true,
            service_version: Some("当前版本".into()),
            message: None,
        };

        assert!(service_status_blocks_runtime_rollback(&incompatible));
        assert!(!service_status_blocks_runtime_rollback(&available));
    }
}
