use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

#[cfg(windows)]
use std::{os::windows::process::CommandExt, ptr};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    core_log,
    defaults::value_to_string,
    mihomo,
    models::{AppSnapshot, SettingsMap},
    subscription, tun_service,
};

const CORE_DIR_NAME: &str = "core";
#[cfg(windows)]
const CORE_EXE_NAME: &str = "mihomo.exe";
#[cfg(not(windows))]
const CORE_EXE_NAME: &str = "mihomo";
const GENERATED_CONFIG_NAME: &str = "config.yaml";
const RUNTIME_CONFIG_KEYS: &[&str] = &[
    "mixedPort",
    "httpPort",
    "socksPort",
    "allowLan",
    "bindAddress",
    "coreMode",
    "proxyMode",
    "logLevel",
    "externalController",
    "controllerPort",
    "uiSecret",
    "ipv6",
    "unifiedDelay",
    "tunMode",
    "networkStack",
    "autoRoute",
    "tunRouteMode",
    "tunSniffer",
    "strictRoute",
    "networkInterface",
    "processMode",
    "dnsEnabled",
    "dnsIpv6",
    "dnsListen",
    "enhancedMode",
    "useHosts",
    "defaultDns",
    "proxyDns",
    "fallbackDns",
    "fakeIpRange",
    "fakeIpFilter",
    "configOverride",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
const CP_OEMCP: u32 = 1;

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn MultiByteToWideChar(
        code_page: u32,
        flags: u32,
        multi_byte: *const u8,
        multi_byte_len: i32,
        wide_char: *mut u16,
        wide_char_len: i32,
    ) -> i32;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MihomoCoreLaunchResult {
    pub started: bool,
    pub controller_ready: bool,
    pub message: String,
}

pub async fn start_core(
    app: AppHandle,
    snapshot: AppSnapshot,
) -> Result<MihomoCoreLaunchResult, String> {
    let settings = &snapshot.settings;
    let config_path = resolve_config_path(&app, &snapshot)?;
    let service_status = tun_service::status(&app)?;
    let service_available = service_is_available(&service_status);
    if mihomo::controller_is_ready(settings).await {
        if service_available && !service_status.running {
            let content = fs::read_to_string(&config_path)
                .map_err(|error| format!("读取 Mihomo 运行配置失败：{error}"))?;
            migrate_to_service(&app, &snapshot, &content).await?;
            return Ok(MihomoCoreLaunchResult {
                started: true,
                controller_ready: true,
                message: "Mihomo 已迁移至系统服务运行".into(),
            });
        }
        return Ok(MihomoCoreLaunchResult {
            started: false,
            controller_ready: true,
            message: "Mihomo 控制器已就绪".into(),
        });
    }

    if service_available {
        let content = fs::read_to_string(&config_path)
            .map_err(|error| format!("读取 Mihomo 运行配置失败：{error}"))?;
        tun_service::start_core(&app, content, settings)?;
    } else if service_status.installed {
        return Err(service_status
            .message
            .unwrap_or_else(|| "Mihomo 系统服务版本不匹配，请删除后重新安装".into()));
    } else if setting_bool(settings, "tunMode", false) {
        return Err("TUN 模式需要先安装可用的 Mihomo 系统服务".into());
    } else {
        spawn_core_process(&app, &config_path, settings)?;
    }

    let controller_ready = wait_controller_ready(settings).await;
    Ok(MihomoCoreLaunchResult {
        started: true,
        controller_ready,
        message: if controller_ready {
            "Mihomo 已启动，控制器已就绪".into()
        } else {
            "已尝试启动 Mihomo，但控制器尚未就绪，请检查配置文件和端口占用".into()
        },
    })
}

fn service_is_available(status: &tun_service::TunServiceStatus) -> bool {
    status.installed && status.version_compatible && status.message.is_none()
}

async fn migrate_to_service(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    content: &str,
) -> Result<(), String> {
    stop_managed_core(app, &snapshot.settings).await?;
    wait_controller_stopped(&snapshot.settings).await;
    tun_service::start_core(app, content.to_string(), &snapshot.settings)?;
    if wait_controller_ready(&snapshot.settings).await {
        Ok(())
    } else {
        Err("系统服务托管的 Mihomo 未能就绪".into())
    }
}

async fn wait_controller_ready(settings: &SettingsMap) -> bool {
    for _ in 0..24 {
        if mihomo::controller_is_ready(settings).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    false
}

fn resolve_config_path(app: &AppHandle, snapshot: &AppSnapshot) -> Result<PathBuf, String> {
    let path = core_dir(app)?.join(GENERATED_CONFIG_NAME);
    let content = subscription::build_effective_config(app, snapshot)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path)
}

pub(crate) fn runtime_config_changed(previous: &SettingsMap, current: &SettingsMap) -> bool {
    RUNTIME_CONFIG_KEYS
        .iter()
        .any(|key| previous.get(*key) != current.get(*key))
}

pub(crate) fn proxy_config_changed(previous: &AppSnapshot, current: &AppSnapshot) -> bool {
    let previous_local_nodes = previous
        .nodes
        .iter()
        .filter(|node| node.origin == "local")
        .collect::<Vec<_>>();
    let current_local_nodes = current
        .nodes
        .iter()
        .filter(|node| node.origin == "local")
        .collect::<Vec<_>>();
    let previous_local_groups = previous
        .groups
        .iter()
        .filter(|group| group.origin == "local")
        .collect::<Vec<_>>();
    let current_local_groups = current
        .groups
        .iter()
        .filter(|group| group.origin == "local")
        .collect::<Vec<_>>();

    previous_local_nodes.len() != current_local_nodes.len()
        || previous_local_nodes.iter().any(|previous_node| {
            current_local_nodes
                .iter()
                .find(|current_node| current_node.id == previous_node.id)
                .is_none_or(|current_node| {
                    previous_node.name != current_node.name
                        || previous_node.protocol != current_node.protocol
                        || previous_node.address != current_node.address
                        || previous_node.port != current_node.port
                        || previous_node.password != current_node.password
                        || previous_node.cipher != current_node.cipher
                        || previous_node.dialer_proxy != current_node.dialer_proxy
                })
        })
        || previous_local_groups.len() != current_local_groups.len()
        || previous_local_groups.iter().any(|previous_group| {
            current_local_groups
                .iter()
                .find(|current_group| current_group.id == previous_group.id)
                .is_none_or(|current_group| {
                    previous_group.name != current_group.name
                        || previous_group.group_type != current_group.group_type
                        || previous_group.icon != current_group.icon
                        || previous_group.description != current_group.description
                        || previous_group.node_ids != current_group.node_ids
                        || previous_group.group_ids != current_group.group_ids
                        || previous_group.auto_test != current_group.auto_test
                        || previous_group.allow_manual != current_group.allow_manual
                        || previous_group.test_url != current_group.test_url
                        || previous_group.interval != current_group.interval
                        || previous_group.tolerance != current_group.tolerance
                        || previous_group.load_balance_strategy
                            != current_group.load_balance_strategy
                        || previous_group.health_check != current_group.health_check
                        || previous_group.failure_threshold != current_group.failure_threshold
                        || previous_group.extra != current_group.extra
                })
        })
        || previous.proxy_group_overrides != current.proxy_group_overrides
        || previous.node_dialer_overrides != current.node_dialer_overrides
}

pub(crate) fn override_config_changed(previous: &AppSnapshot, current: &AppSnapshot) -> bool {
    previous.domain_overrides != current.domain_overrides
}

pub(crate) fn subscription_config_changed(previous: &AppSnapshot, current: &AppSnapshot) -> bool {
    previous
        .subscriptions
        .iter()
        .map(|item| {
            (
                &item.id,
                item.enabled,
                item.proxy_update,
                item.allow_override,
                item.health_check,
                &item.test_url,
                item.update_interval,
            )
        })
        .collect::<Vec<_>>()
        != current
            .subscriptions
            .iter()
            .map(|item| {
                (
                    &item.id,
                    item.enabled,
                    item.proxy_update,
                    item.allow_override,
                    item.health_check,
                    &item.test_url,
                    item.update_interval,
                )
            })
            .collect::<Vec<_>>()
}

pub(crate) fn rule_config_changed(previous: &AppSnapshot, current: &AppSnapshot) -> bool {
    let previous_local_rules = previous
        .rules
        .iter()
        .filter(|rule| rule.source == "local")
        .collect::<Vec<_>>();
    let current_local_rules = current
        .rules
        .iter()
        .filter(|rule| rule.source == "local")
        .collect::<Vec<_>>();

    previous_local_rules != current_local_rules || previous.rule_overrides != current.rule_overrides
}

pub(crate) async fn sync_runtime_config(
    app: &AppHandle,
    snapshot: &AppSnapshot,
) -> Result<(), String> {
    let content = subscription::build_effective_config(app, snapshot)?;
    let path = core_dir(app)?.join(GENERATED_CONFIG_NAME);
    let previous_content = fs::read_to_string(&path).ok();
    let expected_tun = setting_bool(&snapshot.settings, "tunMode", false);
    let tun_changed = previous_content
        .as_deref()
        .and_then(config_tun_enabled)
        .is_some_and(|previous_tun| previous_tun != expected_tun)
        || (!expected_tun && stale_tun_default_route_present());

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if tun_changed {
        fs::write(&path, &content).map_err(|error| format!("保存运行配置失败：{error}"))?;
        switch_tun_runtime(
            app,
            snapshot,
            &path,
            &content,
            previous_content.as_deref(),
            expected_tun,
        )
        .await?;
        return Ok(());
    }

    if mihomo::controller_is_ready(&snapshot.settings).await {
        let controller = mihomo::MihomoClient::from_settings(&snapshot.settings)
            .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
        let service_status = tun_service::status(app)?;
        let service_available = service_is_available(&service_status);

        if service_available && !service_status.running {
            migrate_to_service(app, snapshot, &content).await?;
        } else {
            if service_available {
                tun_service::sync_core_config(app, content.clone(), &snapshot.settings)?;
            }
            if let Err(error) = controller.reload_config(&content).await {
                if service_available {
                    let current_status = tun_service::status(app)?;
                    if current_status.running {
                        let rollback = rollback_service_config(
                            app,
                            snapshot,
                            &path,
                            previous_content.as_deref(),
                        )
                        .await;
                        return Err(match rollback {
                            Ok(()) => format!(
                                "热加载应用运行配置失败：{error}；原 Mihomo 未重启，已恢复上次配置"
                            ),
                            Err(rollback_error) => format!(
                                "热加载应用运行配置失败：{error}；原 Mihomo 未重启，但恢复上次配置失败：{rollback_error}"
                            ),
                        });
                    }
                    tun_service::start_core(app, content.clone(), &snapshot.settings)?;
                    if !wait_controller_ready(&snapshot.settings).await {
                        return Err("Mihomo 已退出，系统服务恢复性拉起后控制器未能就绪".into());
                    }
                } else {
                    return Err(format!("应用运行配置失败：{error}"));
                }
            }
        }

        let actual_tun = controller.runtime_tun_enabled().await;
        let verification = match actual_tun {
            Ok(actual_tun) if actual_tun == expected_tun => Ok(()),
            Ok(actual_tun) => Err(format!(
                "TUN 运行状态校验失败：期望 {}，Mihomo 实际为 {}",
                if expected_tun { "开启" } else { "关闭" },
                if actual_tun { "开启" } else { "关闭" },
            )),
            Err(error) => Err(error),
        };
        if let Err(error) = verification {
            let rollback = if service_available {
                rollback_service_config(app, snapshot, &path, previous_content.as_deref()).await
            } else {
                rollback_runtime_config(&controller, &path, previous_content.as_deref(), false)
                    .await
            };
            return Err(match rollback {
                Ok(()) => format!("{error}；已恢复上次有效运行配置"),
                Err(rollback_error) => {
                    format!("{error}；恢复上次运行配置失败：{rollback_error}")
                }
            });
        }
    }

    fs::write(path, content).map_err(|error| format!("保存运行配置失败：{error}"))
}

async fn switch_tun_runtime(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    config_path: &Path,
    content: &str,
    previous_content: Option<&str>,
    expected_tun: bool,
) -> Result<(), String> {
    let service_status = tun_service::status(app)?;
    let service_available = service_is_available(&service_status);
    if service_status.installed && !service_available {
        restore_config_file(config_path, previous_content)?;
        return Err(service_status
            .message
            .unwrap_or_else(|| "Mihomo 系统服务版本不匹配，请删除后重新安装".into()));
    }
    if expected_tun && !service_available {
        restore_config_file(config_path, previous_content)?;
        return Err("TUN 模式需要先安装可用的 Mihomo 系统服务".into());
    }

    let switch_result = if service_available {
        switch_service_tun_runtime(app, snapshot, content, service_status.running, expected_tun)
            .await
    } else {
        let controller = mihomo::MihomoClient::from_settings(&snapshot.settings)
            .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
        match controller.restart_config(content).await {
            Ok(()) => verify_tun_runtime(&snapshot.settings, expected_tun).await,
            Err(error) => Err(error),
        }
    };
    if let Err(error) = switch_result {
        let rollback = if service_available {
            rollback_service_config(app, snapshot, config_path, previous_content).await
        } else {
            let controller = mihomo::MihomoClient::from_settings(&snapshot.settings)
                .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
            rollback_runtime_config(&controller, config_path, previous_content, true).await
        };
        return Err(match rollback {
            Ok(()) => format!("切换 TUN 失败：{error}；已恢复原运行配置"),
            Err(rollback_error) => {
                format!("切换 TUN 失败：{error}；恢复原运行配置失败：{rollback_error}")
            }
        });
    }

    Ok(())
}

async fn switch_service_tun_runtime(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    content: &str,
    service_running: bool,
    expected_tun: bool,
) -> Result<(), String> {
    if !service_running {
        stop_managed_core(app, &snapshot.settings).await?;
        wait_controller_stopped(&snapshot.settings).await;
        tun_service::start_core(app, content.to_string(), &snapshot.settings)?;
        return verify_tun_runtime(&snapshot.settings, expected_tun).await;
    }

    reload_service_core_config(app, snapshot, content, expected_tun)
        .await
        .map_err(|error| format!("热加载现有 Mihomo 失败：{error}"))
}

async fn reload_service_core_config(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    content: &str,
    expected_tun: bool,
) -> Result<(), String> {
    tun_service::sync_core_config(app, content.to_string(), &snapshot.settings)?;
    let controller = mihomo::MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    controller.reload_config(content).await?;
    verify_tun_runtime(&snapshot.settings, expected_tun).await?;
    tun_service::reconcile_core_network(app)
}

async fn verify_tun_runtime(settings: &SettingsMap, expected_tun: bool) -> Result<(), String> {
    if !wait_controller_ready(settings).await {
        return Err("切换 TUN 后 Mihomo 控制器未能就绪".into());
    }
    let controller = mihomo::MihomoClient::from_settings(settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    let actual_tun = controller.runtime_tun_enabled().await?;
    if actual_tun == expected_tun {
        Ok(())
    } else {
        Err(format!(
            "TUN 运行状态校验失败：期望 {}，Mihomo 实际为 {}",
            if expected_tun { "开启" } else { "关闭" },
            if actual_tun { "开启" } else { "关闭" }
        ))
    }
}

fn restore_config_file(path: &Path, previous_content: Option<&str>) -> Result<(), String> {
    if let Some(previous) = previous_content {
        fs::write(path, previous).map_err(|error| format!("恢复原运行配置失败：{error}"))?;
    }
    Ok(())
}

async fn rollback_service_config(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    config_path: &Path,
    previous_content: Option<&str>,
) -> Result<(), String> {
    restore_config_file(config_path, previous_content)?;
    let Some(previous) = previous_content else {
        return Ok(());
    };
    let previous_tun = config_tun_enabled(previous)
        .ok_or_else(|| "无法读取上次运行配置中的 TUN 状态".to_string())?;
    match reload_service_core_config(app, snapshot, previous, previous_tun).await {
        Ok(()) => Ok(()),
        Err(hot_rollback_error) => {
            let status = tun_service::status(app)?;
            if status.running {
                return Err(format!(
                    "原 Mihomo 仍在运行，但热回滚失败：{hot_rollback_error}"
                ));
            }
            tun_service::start_core(app, previous.to_string(), &snapshot.settings)?;
            verify_tun_runtime(&snapshot.settings, previous_tun)
                .await
                .map_err(|restart_error| {
                    format!("Mihomo 已退出，恢复性拉起后的状态校验失败：{restart_error}")
                })
        }
    }
}

async fn rollback_runtime_config(
    controller: &mihomo::MihomoClient,
    path: &Path,
    previous_content: Option<&str>,
    restart: bool,
) -> Result<(), String> {
    let Some(previous) = previous_content else {
        return Ok(());
    };
    fs::write(path, previous).map_err(|error| format!("写回旧配置失败：{error}"))?;
    if restart {
        controller.restart_config(previous).await
    } else {
        controller.reload_config(previous).await
    }
}

fn config_tun_enabled(content: &str) -> Option<bool> {
    serde_yaml::from_str::<serde_yaml::Value>(content)
        .ok()?
        .get("tun")?
        .get("enable")?
        .as_bool()
}

fn spawn_core_process(
    app: &AppHandle,
    config_path: &Path,
    settings: &SettingsMap,
) -> Result<(), String> {
    let executable = core_executable_path(app)?;
    let directory = core_dir(app)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let log_options = core_log::options_from_settings(&app_data_dir, settings);
    let (stdout, stderr) = core_log::open_log_stdio(&log_options)?;
    let mut command = Command::new(executable);
    command
        .arg("-d")
        .arg(&directory)
        .arg("-f")
        .arg(config_path)
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 Mihomo 内核失败：{error}"))?;
    let pid = child.id();
    let pid_path = managed_core_pid_path(app)?;
    if let Err(error) = fs::write(&pid_path, pid.to_string()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("记录 Mihomo 进程失败：{error}"));
    }
    std::thread::spawn(move || {
        let _ = child.wait();
        let recorded_pid = fs::read_to_string(&pid_path)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok());
        if recorded_pid == Some(pid) {
            let _ = fs::remove_file(pid_path);
        }
    });
    Ok(())
}

fn managed_core_pid_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(core_dir(app)?.join("mihomo.pid"))
}

async fn stop_managed_core(app: &AppHandle, settings: &SettingsMap) -> Result<(), String> {
    stop_managed_core_process(app, settings, true).await
}

pub(crate) async fn stop_managed_core_on_exit(
    app: &AppHandle,
    settings: &SettingsMap,
) -> Result<(), String> {
    stop_managed_core_process(app, settings, false).await
}

async fn stop_managed_core_process(
    app: &AppHandle,
    settings: &SettingsMap,
    allow_controller_fallback: bool,
) -> Result<(), String> {
    let pid_path = managed_core_pid_path(app)?;
    let stored_pid = fs::read_to_string(&pid_path)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok());
    #[cfg(windows)]
    let pid = stored_pid.or_else(|| {
        allow_controller_fallback
            .then(|| controller_process_id(settings).ok())
            .flatten()
    });
    #[cfg(not(windows))]
    let pid = stored_pid;
    let Some(pid) = pid else {
        return if allow_controller_fallback && mihomo::controller_is_ready(settings).await {
            Err("Mihomo 控制器仍在运行，但未找到由应用启动的进程记录".into())
        } else {
            Ok(())
        };
    };

    #[cfg(windows)]
    stop_process(pid)?;
    #[cfg(not(windows))]
    {
        if !unix_process_is_running(pid)? {
            let _ = fs::remove_file(pid_path);
            return Ok(());
        }
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("停止旧 Mihomo 进程失败：{error}"))?;
        if !status.success() {
            return Err("停止旧 Mihomo 进程失败".into());
        }
        if !wait_unix_process_stopped(pid).await? {
            let status = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|error| format!("强制停止旧 Mihomo 进程失败：{error}"))?;
            if !status.success() || !wait_unix_process_stopped(pid).await? {
                return Err("旧 Mihomo 进程未能在超时前退出".into());
            }
        }
    }

    let _ = fs::remove_file(pid_path);
    Ok(())
}

#[cfg(not(windows))]
fn unix_process_is_running(pid: u32) -> Result<bool, String> {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .map_err(|error| format!("检查 Mihomo 进程状态失败：{error}"))
}

#[cfg(not(windows))]
async fn wait_unix_process_stopped(pid: u32) -> Result<bool, String> {
    for _ in 0..50 {
        if !unix_process_is_running(pid)? {
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(false)
}

async fn wait_controller_stopped(settings: &SettingsMap) {
    for _ in 0..20 {
        if !mihomo::controller_is_ready(settings).await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(windows)]
fn controller_process_id(settings: &SettingsMap) -> Result<u32, String> {
    let port = controller_address(settings)
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
        .ok_or_else(|| "无法从外部控制器地址解析端口".to_string())?;
    let mut command = Command::new("netstat.exe");
    command.args(["-ano", "-p", "tcp"]);
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("查询 Mihomo 控制器进程失败：{error}"))?;
    let suffix = format!(":{port}");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            (columns.len() >= 5
                && columns[0].eq_ignore_ascii_case("TCP")
                && columns[1].ends_with(&suffix))
            .then(|| columns.last()?.parse::<u32>().ok())
            .flatten()
        })
        .next()
        .ok_or_else(|| "未找到正在监听的 Mihomo 控制器进程".into())
}

#[cfg(windows)]
fn stop_process(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill.exe");
    command.args(["/PID", &pid.to_string(), "/F"]);
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("停止旧 Mihomo 进程失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let normal_error = command_error_message(&output.stdout, &output.stderr);
    let script = format!(
        "$process = Start-Process -FilePath 'taskkill.exe' -ArgumentList '/PID','{pid}','/F' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode"
    );
    let mut elevated = Command::new("powershell.exe");
    elevated.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &script,
    ]);
    elevated.creation_flags(CREATE_NO_WINDOW);
    let elevated_output = elevated.output().map_err(|error| {
        format!("停止旧 Mihomo 进程失败：{normal_error}；请求管理员权限失败：{error}")
    })?;
    if elevated_output.status.success() {
        return Ok(());
    }

    let elevated_error = command_error_message(&elevated_output.stdout, &elevated_output.stderr);
    Err(format!(
        "停止旧 Mihomo 进程失败：{normal_error}；管理员权限终止仍失败：{elevated_error}"
    ))
}

#[cfg(windows)]
fn command_error_message(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = decode_windows_command_output(stderr);
    if !stderr.trim().is_empty() {
        return stderr.trim().to_string();
    }
    let stdout = decode_windows_command_output(stdout);
    if !stdout.trim().is_empty() {
        return stdout.trim().to_string();
    }
    "命令未返回错误详情".into()
}

#[cfg(windows)]
fn decode_windows_command_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(value) = std::str::from_utf8(bytes) {
        return value.to_string();
    }

    let Ok(byte_len) = i32::try_from(bytes.len()) else {
        return String::from_utf8_lossy(bytes).into_owned();
    };
    let wide_len =
        unsafe { MultiByteToWideChar(CP_OEMCP, 0, bytes.as_ptr(), byte_len, ptr::null_mut(), 0) };
    if wide_len <= 0 {
        return String::from_utf8_lossy(bytes).into_owned();
    }

    let mut wide = vec![0_u16; wide_len as usize];
    let converted = unsafe {
        MultiByteToWideChar(
            CP_OEMCP,
            0,
            bytes.as_ptr(),
            byte_len,
            wide.as_mut_ptr(),
            wide_len,
        )
    };
    if converted <= 0 {
        String::from_utf8_lossy(bytes).into_owned()
    } else {
        String::from_utf16_lossy(&wide[..converted as usize])
    }
}

#[cfg(all(windows, test))]
fn quote_windows_argument(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(windows)]
fn stale_tun_default_route_present() -> bool {
    let mut command = Command::new("route.exe");
    command.args(["print", "-4"]);
    command.creation_flags(CREATE_NO_WINDOW);
    let Ok(output) = command.output() else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        let columns = line.split_whitespace().collect::<Vec<_>>();
        columns.len() >= 3
            && columns[0] == "0.0.0.0"
            && columns[1] == "0.0.0.0"
            && columns[2] == "198.18.0.2"
    })
}

#[cfg(not(windows))]
fn stale_tun_default_route_present() -> bool {
    false
}

pub(crate) fn generated_config_content(settings: &SettingsMap) -> String {
    let proxy_mode = setting_string(
        settings,
        "proxyMode",
        &setting_string(settings, "coreMode", "规则模式"),
    );
    format!(
        "mixed-port: {}\nport: {}\nsocks-port: {}\nallow-lan: {}\nbind-address: {}\nmode: {}\nlog-level: {}\nexternal-controller: {}\nsecret: {}\nipv6: {}\nunified-delay: {}\nfind-process-mode: {}\nprofile:\n  store-selected: true\n  store-fake-ip: true\nproxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n",
        setting_number(settings, "mixedPort", 7890),
        setting_number(settings, "httpPort", 7892),
        setting_number(settings, "socksPort", 7891),
        setting_bool(settings, "allowLan", false),
        yaml_string(&setting_string(settings, "bindAddress", "0.0.0.0")),
        yaml_string(&map_mode(&proxy_mode)),
        yaml_string(&map_log_level(&setting_string(settings, "logLevel", "信息 (Info)"))),
        yaml_string(&controller_address(settings)),
        yaml_string(&setting_string(settings, "uiSecret", "")),
        setting_bool(settings, "ipv6", false),
        setting_bool(settings, "unifiedDelay", true),
        yaml_string(&map_process_mode(&setting_string(settings, "processMode", "Always"))),
    )
}

pub(crate) fn core_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(CORE_DIR_NAME))
}

pub(crate) fn core_executable_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("定位应用程序失败：{error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "应用程序路径缺少父目录".to_string())?;
    Ok(directory.join(CORE_EXE_NAME))
}

pub(crate) fn merge_core_failure_logs(app: &AppHandle, snapshot: &mut AppSnapshot) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    let options = core_log::options_from_settings(&app_data_dir, &snapshot.settings);
    if !options.enabled {
        return;
    }

    let content = if tun_service::status(app).is_ok_and(|status| status.installed) {
        tun_service::read_core_log(app)
    } else {
        core_log::read_log_tail(&options.path, core_log::LOG_TAIL_MAX_BYTES)
    };
    let Ok(content) = content else {
        return;
    };

    let limit = snapshot
        .settings
        .get("maxLogRows")
        .and_then(|value| value.as_u64())
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(1000);
    let entries = core_log::failure_entries(&content, limit);
    if entries.is_empty() {
        return;
    }

    let incoming_ids = entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    snapshot
        .logs
        .retain(|entry| !incoming_ids.contains(entry.id.as_str()));
    snapshot.logs.splice(0..0, entries);
    snapshot.logs.truncate(limit);
}

fn controller_address(settings: &SettingsMap) -> String {
    let raw = settings
        .get("externalController")
        .and_then(value_to_string)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| settings.get("controllerPort").and_then(value_to_string))
        .unwrap_or_else(|| "127.0.0.1:9090".into());
    let value = raw.trim().trim_end_matches('/').to_string();

    value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .unwrap_or(&value)
        .to_string()
}

fn setting_string(settings: &SettingsMap, key: &str, fallback: &str) -> String {
    settings
        .get(key)
        .and_then(value_to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.into())
}

fn setting_number(settings: &SettingsMap, key: &str, fallback: u16) -> u16 {
    settings
        .get(key)
        .and_then(value_to_string)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(fallback)
}

fn setting_bool(settings: &SettingsMap, key: &str, fallback: bool) -> bool {
    settings
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(fallback)
}

fn map_mode(value: &str) -> String {
    match value {
        "全局模式" => "global",
        "直连模式" => "direct",
        _ => "rule",
    }
    .into()
}

fn map_process_mode(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "always" | "始终" => "always",
        "off" | "关闭" => "off",
        _ => "strict",
    }
    .into()
}

fn map_log_level(value: &str) -> String {
    if value.contains("Debug") || value.contains("调试") {
        "debug"
    } else if value.contains("Warning") || value.contains("警告") {
        "warning"
    } else if value.contains("Error") || value.contains("错误") {
        "error"
    } else {
        "info"
    }
    .into()
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_runtime_config_changes() {
        let previous = crate::defaults::default_settings();
        let mut current = previous.clone();
        current.insert("tunMode".into(), serde_json::json!(true));
        assert!(runtime_config_changed(&previous, &current));

        let mut ui_only = previous.clone();
        ui_only.insert("compactMode".into(), serde_json::json!(true));
        assert!(!runtime_config_changed(&previous, &ui_only));
    }

    #[test]
    fn detects_local_proxy_configuration_without_treating_selection_as_config() {
        let mut previous = crate::defaults::default_snapshot();
        previous.groups.push(crate::models::ProxyGroup {
            id: "local".into(),
            name: "手动前置".into(),
            group_type: "Selector".into(),
            origin: "local".into(),
            icon: String::new(),
            description: String::new(),
            node_ids: vec!["node-a".into(), "node-b".into()],
            group_ids: Vec::new(),
            current_node_id: Some("node-a".into()),
            auto_test: false,
            allow_manual: true,
            test_url: "https://www.gstatic.com/generate_204".into(),
            interval: 300,
            tolerance: 50,
            load_balance_strategy: "round-robin".into(),
            health_check: true,
            failure_threshold: 3,
            extra: String::new(),
        });

        let mut selection_only = previous.clone();
        selection_only.groups[0].current_node_id = Some("node-b".into());
        assert!(!proxy_config_changed(&previous, &selection_only));

        let mut members_changed = previous.clone();
        members_changed.groups[0].group_ids.push("nested".into());
        assert!(proxy_config_changed(&previous, &members_changed));

        let mut override_changed = previous.clone();
        override_changed
            .proxy_group_overrides
            .push(crate::models::ProxyGroupMemberOverride {
                target_group_id: "ai".into(),
                target_group_name: "AI".into(),
                added_group_ids: vec!["local".into()],
            });
        assert!(proxy_config_changed(&previous, &override_changed));

        let mut dialer_override_changed = previous.clone();
        dialer_override_changed.node_dialer_overrides.push(
            crate::models::ProxyNodeDialerOverride {
                target_node_id: "node-a".into(),
                target_node_name: "节点 A".into(),
                dialer_proxy: Some("香港前置".into()),
            },
        );
        assert!(proxy_config_changed(&previous, &dialer_override_changed));
    }

    #[test]
    fn generated_config_uses_user_facing_proxy_mode() {
        let mut settings = crate::defaults::default_settings();
        settings.insert("proxyMode".into(), serde_json::json!("全局模式"));
        settings.insert("coreMode".into(), serde_json::json!("规则模式"));

        let config = generated_config_content(&settings);

        assert!(config.contains("mode: \"global\""));
    }

    #[test]
    fn reads_tun_state_from_effective_config() {
        assert_eq!(
            config_tun_enabled("tun:\n  enable: true\n  stack: mixed\n"),
            Some(true)
        );
        assert_eq!(config_tun_enabled("rules: []\n"), None);
    }

    #[cfg(windows)]
    #[test]
    fn quotes_elevated_core_arguments() {
        assert_eq!(
            quote_windows_argument("C:\\Program Files\\mihomo"),
            "\"C:\\Program Files\\mihomo\""
        );
    }
}
