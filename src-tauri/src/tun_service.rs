use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{core, core_log, models::SettingsMap};

#[cfg(windows)]
const SERVICE_NAME: &str = "ClashMgTunService";
#[cfg(target_os = "macos")]
const SERVICE_LABEL: &str = "com.clashmg.tun-service";
const SERVICE_PORT: u16 = 47892;
const SERVICE_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "-service.9");
const CLIENT_CONFIG_NAME: &str = "tun-service.json";
const RUNTIME_STATE_NAME: &str = "runtime-state.json";
const MAX_REQUEST_BYTES: u64 = 48 * 1024 * 1024;
const MAX_CONFIG_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const IPC_TIMEOUT: Duration = Duration::from_secs(60);
const CORE_RUNTIME_FILE_NAMES: &[&str] = &[
    "Country.mmdb",
    "geoip.metadb",
    "geosite.dat",
    "geoip.dat",
    "cache.db",
];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunServiceClientConfig {
    token: String,
    version: String,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunServiceDaemonConfig {
    token: String,
    version: String,
    core_path: PathBuf,
    data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunServiceStatus {
    pub installed: bool,
    pub running: bool,
    pub version_compatible: bool,
    pub service_version: Option<String>,
    pub message: Option<String>,
}

impl TunServiceStatus {
    fn not_installed() -> Self {
        Self {
            installed: false,
            running: false,
            version_compatible: false,
            service_version: None,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunServiceFile {
    path: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunServiceRequest {
    token: String,
    action: String,
    version: String,
    config: Option<String>,
    files: Vec<TunServiceFile>,
    #[serde(default)]
    core_dir: Option<String>,
    #[serde(default)]
    log_enabled: Option<bool>,
    #[serde(default)]
    log_max_bytes: Option<u64>,
    #[serde(default)]
    rotate_logs: Option<bool>,
    #[serde(default)]
    override_system_dns: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunServiceResponse {
    ok: bool,
    running: bool,
    version: String,
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    log_content: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct TunLogOptions {
    enabled: bool,
    max_bytes: u64,
    rotate: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRuntimeState {
    log: TunLogOptions,
    override_system_dns: bool,
}

struct ServiceRuntime {
    child: Option<Child>,
}

impl ServiceRuntime {
    fn running(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => {
                self.child = None;
                if let Err(error) = restore_system_dns() {
                    append_service_log(&format!("Mihomo 异常退出后恢复系统 DNS 失败：{error}"));
                }
                false
            }
        }
    }

    fn stop(&mut self) -> Result<(), String> {
        let process_result = if let Some(mut child) = self.child.take() {
            let result = child
                .kill()
                .map_err(|error| format!("停止服务托管的 Mihomo 失败：{error}"));
            if result.is_ok() {
                let _ = child.wait();
            }
            result
        } else {
            Ok(())
        };
        let dns_result = restore_system_dns();
        match (process_result, dns_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
            (Err(process_error), Err(dns_error)) => {
                Err(format!("{process_error}；恢复系统 DNS 失败：{dns_error}"))
            }
        }
    }
}

pub fn try_run_cli() -> Option<i32> {
    let arguments = std::env::args().collect::<Vec<_>>();
    let command = arguments.get(1)?.as_str();
    let result = match command {
        "--tun-service" => run_service_entry(),
        "--install-tun-service-elevated" => {
            let client_config = arguments
                .get(2)
                .map(PathBuf::from)
                .ok_or_else(|| "缺少客户端服务配置路径".to_string());
            let core_path = arguments
                .get(3)
                .map(PathBuf::from)
                .ok_or_else(|| "缺少 Mihomo 内核路径".to_string());
            match (client_config, core_path) {
                (Ok(client_config), Ok(core_path)) => install_elevated(&client_config, &core_path),
                (Err(error), _) | (_, Err(error)) => Err(error),
            }
        }
        "--uninstall-tun-service-elevated" => uninstall_elevated(),
        _ => return None,
    };

    if let Err(error) = result {
        if command == "--tun-service" {
            append_service_log(&format!("系统服务退出：{error}"));
        }
        eprintln!("{error}");
        Some(1)
    } else {
        Some(0)
    }
}

pub fn status(app: &AppHandle) -> Result<TunServiceStatus, String> {
    let Some(config) = read_client_config(app)? else {
        if platform_service_registered() {
            return Ok(TunServiceStatus {
                installed: true,
                running: false,
                version_compatible: false,
                service_version: None,
                message: Some("服务认证信息缺失，请删除服务后重新安装".into()),
            });
        }
        return Ok(TunServiceStatus::not_installed());
    };

    match send_request(
        &config,
        TunServiceRequest {
            token: config.token.clone(),
            action: "status".into(),
            version: SERVICE_VERSION.into(),
            config: None,
            files: Vec::new(),
            core_dir: None,
            log_enabled: None,
            log_max_bytes: None,
            rotate_logs: None,
            override_system_dns: None,
        },
    ) {
        Ok(response) => Ok(TunServiceStatus {
            installed: true,
            running: response.running,
            version_compatible: response.version == SERVICE_VERSION,
            service_version: Some(response.version),
            message: response.message,
        }),
        Err(error) => Ok(TunServiceStatus {
            installed: true,
            running: false,
            version_compatible: config.version == SERVICE_VERSION,
            service_version: Some(config.version),
            message: Some(format!("系统服务暂不可用：{error}")),
        }),
    }
}

pub fn install(app: &AppHandle) -> Result<TunServiceStatus, String> {
    let current = status(app)?;
    if current.installed && current.version_compatible {
        return Ok(current);
    }

    let core_path = core::core_executable_path(app)?;

    let client_path = client_config_path(app)?;
    let config = TunServiceClientConfig {
        token: generate_token()?,
        version: SERVICE_VERSION.into(),
        port: SERVICE_PORT,
    };
    write_private_json(&client_path, &config)?;

    let arguments = vec![
        "--install-tun-service-elevated".to_string(),
        client_path.to_string_lossy().into_owned(),
        core_path.to_string_lossy().into_owned(),
    ];
    if let Err(error) = run_elevated(&arguments) {
        let _ = fs::remove_file(&client_path);
        return Err(error);
    }

    for _ in 0..30 {
        let service_status = status(app)?;
        if service_status.installed
            && service_status.version_compatible
            && service_status.message.is_none()
        {
            return Ok(service_status);
        }
        thread::sleep(Duration::from_millis(200));
    }

    let service_status = status(app)?;
    if service_status.message.is_some() {
        Err(service_status
            .message
            .unwrap_or_else(|| "系统服务安装后未能启动".into()))
    } else {
        Ok(service_status)
    }
}

pub fn uninstall(app: &AppHandle) -> Result<TunServiceStatus, String> {
    let _ = stop_core(app);

    run_elevated(&["--uninstall-tun-service-elevated".into()])?;
    let client_path = client_config_path(app)?;
    if client_path.exists() {
        fs::remove_file(client_path).map_err(|error| format!("删除服务状态文件失败：{error}"))?;
    }
    Ok(TunServiceStatus::not_installed())
}

pub fn start_core(
    app: &AppHandle,
    config_content: String,
    settings: &SettingsMap,
) -> Result<(), String> {
    let config = read_client_config(app)?.ok_or_else(|| "尚未安装 Mihomo 系统服务".to_string())?;
    let response = send_request(
        &config,
        runtime_request(app, &config, "start", config_content, settings)?,
    )?;
    if response.ok {
        Ok(())
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "Mihomo 系统服务启动内核失败".into()))
    }
}

pub fn sync_core_config(
    app: &AppHandle,
    config_content: String,
    settings: &SettingsMap,
) -> Result<(), String> {
    let config = read_client_config(app)?.ok_or_else(|| "尚未安装 Mihomo 系统服务".to_string())?;
    let response = send_request(
        &config,
        runtime_request(app, &config, "sync", config_content, settings)?,
    )?;
    if response.ok {
        Ok(())
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "同步 Mihomo 系统服务配置失败".into()))
    }
}

pub fn reconcile_core_network(app: &AppHandle) -> Result<(), String> {
    let config = read_client_config(app)?.ok_or_else(|| "尚未安装 Mihomo 系统服务".to_string())?;
    let response = send_request(
        &config,
        TunServiceRequest {
            token: config.token.clone(),
            action: "network".into(),
            version: SERVICE_VERSION.into(),
            config: None,
            files: Vec::new(),
            core_dir: None,
            log_enabled: None,
            log_max_bytes: None,
            rotate_logs: None,
            override_system_dns: None,
        },
    )?;
    if response.ok {
        Ok(())
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "同步 Mihomo 系统网络状态失败".into()))
    }
}

fn runtime_request(
    app: &AppHandle,
    config: &TunServiceClientConfig,
    action: &str,
    config_content: String,
    settings: &SettingsMap,
) -> Result<TunServiceRequest, String> {
    let files = collect_service_files(app)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let log_options = core_log::options_from_settings(&app_data_dir, settings);
    Ok(TunServiceRequest {
        token: config.token.clone(),
        action: action.into(),
        version: SERVICE_VERSION.into(),
        config: Some(config_content),
        files,
        core_dir: core::core_dir(app)
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        log_enabled: Some(log_options.enabled),
        log_max_bytes: Some(log_options.max_bytes),
        rotate_logs: Some(log_options.rotate),
        override_system_dns: Some(
            settings
                .get("overrideSystemDns")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true),
        ),
    })
}

pub fn stop_core(app: &AppHandle) -> Result<(), String> {
    let Some(config) = read_client_config(app)? else {
        return Ok(());
    };
    let response = send_request(
        &config,
        TunServiceRequest {
            token: config.token.clone(),
            action: "stop".into(),
            version: SERVICE_VERSION.into(),
            config: None,
            files: Vec::new(),
            core_dir: None,
            log_enabled: None,
            log_max_bytes: None,
            rotate_logs: None,
            override_system_dns: None,
        },
    )?;
    if response.ok {
        Ok(())
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "停止系统服务托管的 Mihomo 失败".into()))
    }
}

pub fn read_core_log(app: &AppHandle) -> Result<String, String> {
    let config = read_client_config(app)?.ok_or_else(|| "尚未安装 Mihomo 系统服务".to_string())?;
    let response = send_request(
        &config,
        TunServiceRequest {
            token: config.token.clone(),
            action: "logs".into(),
            version: SERVICE_VERSION.into(),
            config: None,
            files: Vec::new(),
            core_dir: None,
            log_enabled: None,
            log_max_bytes: None,
            rotate_logs: None,
            override_system_dns: None,
        },
    )?;
    if response.ok {
        Ok(response.log_content.unwrap_or_default())
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "读取系统服务 Mihomo 日志失败".into()))
    }
}

fn client_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(CLIENT_CONFIG_NAME))
}

fn read_client_config(app: &AppHandle) -> Result<Option<TunServiceClientConfig>, String> {
    let path = client_config_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|error| format!("读取 Mihomo 系统服务状态失败：{error}"))
}

fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("生成服务认证令牌失败：{error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_private_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn collect_service_files(app: &AppHandle) -> Result<Vec<TunServiceFile>, String> {
    let directory = core::core_dir(app)?.join("subscriptions");
    if !directory.is_dir() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    let mut total_size = 0_usize;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("yaml") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_safe_file_name(file_name) {
            return Err(format!("订阅缓存文件名不安全：{file_name}"));
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("读取订阅缓存“{file_name}”失败：{error}"))?;
        total_size = total_size.saturating_add(content.len());
        if total_size > MAX_FILE_BYTES {
            return Err("Mihomo 服务运行文件总大小超过 16 MB 限制".into());
        }
        result.push(TunServiceFile {
            path: format!("subscriptions/{file_name}"),
            content,
        });
    }
    Ok(result)
}

fn is_safe_file_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

fn send_request(
    config: &TunServiceClientConfig,
    request: TunServiceRequest,
) -> Result<TunServiceResponse, String> {
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", config.port)
            .parse()
            .map_err(|error| format!("解析服务地址失败：{error}"))?,
        Duration::from_millis(800),
    )
    .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(IPC_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(IPC_TIMEOUT))
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut stream, &request)
        .map_err(|error| format!("向 Mihomo 系统服务发送请求失败：{error}"))?;
    stream
        .write_all(b"\n")
        .map_err(|error| format!("结束 Mihomo 系统服务请求失败：{error}"))?;
    stream
        .flush()
        .map_err(|error| format!("提交 Mihomo 系统服务请求失败：{error}"))?;

    let mut response = String::new();
    BufReader::new(stream)
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut response)
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&response).map_err(|error| format!("解析系统服务响应失败：{error}"))
}

fn run_service_entry() -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_service_host::run();
    }
    #[cfg(not(windows))]
    {
        let stop = Arc::new(AtomicBool::new(false));
        signal_hook::flag::register(signal_hook::consts::SIGTERM, Arc::clone(&stop))
            .map_err(|error| error.to_string())?;
        signal_hook::flag::register(signal_hook::consts::SIGINT, Arc::clone(&stop))
            .map_err(|error| error.to_string())?;
        run_service_loop(stop)
    }
}

fn run_service_loop(stop: Arc<AtomicBool>) -> Result<(), String> {
    let daemon_config = read_daemon_config()?;
    if let Err(error) = restore_system_dns() {
        append_service_log(&format!("服务启动时恢复遗留系统 DNS 失败：{error}"));
    }
    let listener = TcpListener::bind(("127.0.0.1", SERVICE_PORT))
        .map_err(|error| format!("Mihomo 系统服务监听本地端口失败：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let mut runtime = ServiceRuntime { child: None };
    if let Err(error) = start_persisted_core(&daemon_config, &mut runtime) {
        append_service_log(&format!("恢复常驻 Mihomo 失败：{error}"));
    }

    let loop_result = loop {
        if stop.load(Ordering::Relaxed) {
            break Ok(());
        }
        runtime.running();
        match listener.accept() {
            Ok((stream, _)) => handle_connection(stream, &daemon_config, &mut runtime),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(80));
            }
            Err(error) => break Err(format!("Mihomo 系统服务接收连接失败：{error}")),
        }
    };
    let stop_result = runtime.stop();
    match (loop_result, stop_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(loop_error), Err(stop_error)) => {
            Err(format!("{loop_error}；停止 TUN 运行环境失败：{stop_error}"))
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
) {
    if let Err(error) = configure_accepted_stream(&stream) {
        append_service_log(&error);
        return;
    }
    let result =
        read_request(&stream).and_then(|request| handle_request(request, daemon_config, runtime));
    if let Err(error) = &result {
        append_service_log(&format!("处理 IPC 请求失败：{error}"));
    }
    let response = result.unwrap_or_else(|error| TunServiceResponse {
        ok: false,
        running: runtime.running(),
        version: SERVICE_VERSION.into(),
        message: Some(error),
        log_content: None,
    });
    if serde_json::to_writer(&mut stream, &response).is_ok() {
        let _ = stream.write_all(b"\n");
        let _ = stream.flush();
    }
}

fn configure_accepted_stream(stream: &TcpStream) -> Result<(), String> {
    stream
        .set_nonblocking(false)
        .map_err(|error| format!("恢复 IPC 连接阻塞模式失败：{error}"))?;
    stream
        .set_read_timeout(Some(IPC_TIMEOUT))
        .map_err(|error| format!("设置 IPC 读取超时失败：{error}"))?;
    stream
        .set_write_timeout(Some(IPC_TIMEOUT))
        .map_err(|error| format!("设置 IPC 写入超时失败：{error}"))
}

fn append_service_log(message: &str) {
    let path = service_install_dir().join("service.log");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn read_request(stream: &TcpStream) -> Result<TunServiceRequest, String> {
    let mut content = String::new();
    BufReader::new(stream)
        .take(MAX_REQUEST_BYTES)
        .read_line(&mut content)
        .map_err(|error| error.to_string())?;
    if content.is_empty() {
        return Err("系统服务收到空请求".into());
    }
    serde_json::from_str(&content).map_err(|error| format!("系统服务请求格式无效：{error}"))
}

fn handle_request(
    request: TunServiceRequest,
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
) -> Result<TunServiceResponse, String> {
    if request.token != daemon_config.token {
        return Err("Mihomo 系统服务认证失败".into());
    }
    if request.version != SERVICE_VERSION {
        return Ok(TunServiceResponse {
            ok: false,
            running: runtime.running(),
            version: SERVICE_VERSION.into(),
            message: Some("系统服务版本与应用不一致，请删除后重新安装".into()),
            log_content: None,
        });
    }

    let log_options = TunLogOptions {
        enabled: request.log_enabled.unwrap_or(true),
        max_bytes: request.log_max_bytes.unwrap_or(10 * 1024 * 1024),
        rotate: request.rotate_logs.unwrap_or(true),
    };
    match request.action.as_str() {
        "status" => Ok(TunServiceResponse {
            ok: true,
            running: runtime.running(),
            version: SERVICE_VERSION.into(),
            message: None,
            log_content: None,
        }),
        "stop" => {
            runtime.stop()?;
            Ok(TunServiceResponse {
                ok: true,
                running: false,
                version: SERVICE_VERSION.into(),
                message: None,
                log_content: None,
            })
        }
        "logs" => {
            let path = daemon_config.data_dir.join("core.log");
            let content = if path.is_file() {
                core_log::read_log_tail(&path, core_log::LOG_TAIL_MAX_BYTES)?
            } else {
                String::new()
            };
            Ok(TunServiceResponse {
                ok: true,
                running: runtime.running(),
                version: SERVICE_VERSION.into(),
                message: None,
                log_content: Some(content),
            })
        }
        "start" => {
            let content = request
                .config
                .ok_or_else(|| "启动 Mihomo 缺少运行配置".to_string())?;
            start_managed_core(
                daemon_config,
                runtime,
                &content,
                &request.files,
                request.core_dir.as_deref(),
                log_options,
                request.override_system_dns.unwrap_or(false),
            )?;
            Ok(TunServiceResponse {
                ok: true,
                running: true,
                version: SERVICE_VERSION.into(),
                message: None,
                log_content: None,
            })
        }
        "sync" => {
            let content = request
                .config
                .ok_or_else(|| "同步 Mihomo 缺少运行配置".to_string())?;
            sync_managed_core_files(
                daemon_config,
                &content,
                &request.files,
                request.core_dir.as_deref(),
                PersistedRuntimeState {
                    log: log_options,
                    override_system_dns: request.override_system_dns.unwrap_or(false),
                },
            )?;
            Ok(TunServiceResponse {
                ok: true,
                running: runtime.running(),
                version: SERVICE_VERSION.into(),
                message: None,
                log_content: None,
            })
        }
        "network" => {
            reconcile_managed_network(daemon_config, runtime)?;
            Ok(TunServiceResponse {
                ok: true,
                running: true,
                version: SERVICE_VERSION.into(),
                message: None,
                log_content: None,
            })
        }
        _ => Err("Mihomo 系统服务不支持该操作".into()),
    }
}

fn start_managed_core(
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
    content: &str,
    files: &[TunServiceFile],
    core_dir: Option<&str>,
    log: TunLogOptions,
    override_system_dns: bool,
) -> Result<(), String> {
    runtime.stop()?;
    let state = PersistedRuntimeState {
        log,
        override_system_dns,
    };
    sync_managed_core_files(daemon_config, content, files, core_dir, state)?;
    spawn_managed_core(daemon_config, runtime, content, state)
}

fn sync_managed_core_files(
    daemon_config: &TunServiceDaemonConfig,
    content: &str,
    files: &[TunServiceFile],
    core_dir: Option<&str>,
    state: PersistedRuntimeState,
) -> Result<(), String> {
    validate_service_config(content)?;
    fs::create_dir_all(&daemon_config.data_dir).map_err(|error| error.to_string())?;

    let subscriptions = daemon_config.data_dir.join("subscriptions");
    if subscriptions.exists() {
        fs::remove_dir_all(&subscriptions).map_err(|error| error.to_string())?;
    }
    for file in files {
        let relative = validate_relative_path(&file.path)?;
        let target = daemon_config.data_dir.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(target, &file.content).map_err(|error| error.to_string())?;
    }

    if let Some(core_dir) = core_dir {
        copy_core_runtime_files(Path::new(core_dir), &daemon_config.data_dir)?;
    }

    let config_path = daemon_config.data_dir.join("config.yaml");
    fs::write(&config_path, content).map_err(|error| error.to_string())?;
    write_private_json(&runtime_state_path(), &state)
        .map_err(|error| format!("保存 Mihomo 常驻状态失败：{error}"))
}

fn spawn_managed_core(
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
    content: &str,
    state: PersistedRuntimeState,
) -> Result<(), String> {
    let tun_enabled = validate_service_config(content)?;
    let config_path = daemon_config.data_dir.join("config.yaml");
    let log_options = core_log::CoreLogOptions {
        enabled: state.log.enabled,
        path: daemon_config.data_dir.join("core.log"),
        rotate: state.log.rotate,
        max_bytes: state.log.max_bytes,
    };
    let (log_file_out, log_file_err) = core_log::open_log_stdio(&log_options)?;

    let child = Command::new(&daemon_config.core_path)
        .arg("-d")
        .arg(&daemon_config.data_dir)
        .arg("-f")
        .arg(&config_path)
        .current_dir(&daemon_config.data_dir)
        .stdin(Stdio::null())
        .stdout(log_file_out)
        .stderr(log_file_err)
        .spawn()
        .map_err(|error| format!("系统服务启动 Mihomo 失败：{error}"))?;
    runtime.child = Some(child);
    if should_override_system_dns(tun_enabled, state.override_system_dns) {
        if let Err(error) = apply_system_dns_override() {
            let rollback = runtime.stop();
            return Err(match rollback {
                Ok(()) => format!("接管系统 DNS 失败：{error}；已停止 Mihomo 并恢复网络设置"),
                Err(rollback_error) => format!(
                    "接管系统 DNS 失败：{error}；停止 Mihomo 或恢复网络设置失败：{rollback_error}"
                ),
            });
        }
    }
    Ok(())
}

fn start_persisted_core(
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
) -> Result<(), String> {
    let config_path = daemon_config.data_dir.join("config.yaml");
    let state_path = runtime_state_path();
    if !config_path.is_file() || !state_path.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取常驻 Mihomo 配置失败：{error}"))?;
    let state = read_persisted_runtime_state(&state_path)?;
    spawn_managed_core(daemon_config, runtime, &content, state)
}

fn reconcile_managed_network(
    daemon_config: &TunServiceDaemonConfig,
    runtime: &mut ServiceRuntime,
) -> Result<(), String> {
    if !runtime.running() {
        restore_system_dns()?;
        return Err("系统服务托管的 Mihomo 未在运行".into());
    }

    let config_path = daemon_config.data_dir.join("config.yaml");
    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取 Mihomo 常驻配置失败：{error}"))?;
    let state = read_persisted_runtime_state(&runtime_state_path())?;
    if should_override_system_dns(
        validate_service_config(&content)?,
        state.override_system_dns,
    ) {
        apply_system_dns_override()
    } else {
        restore_system_dns()
    }
}

fn read_persisted_runtime_state(path: &Path) -> Result<PersistedRuntimeState, String> {
    let content = fs::read(path).map_err(|error| format!("读取 Mihomo 常驻状态失败：{error}"))?;
    serde_json::from_slice(&content).map_err(|error| format!("解析 Mihomo 常驻状态失败：{error}"))
}

fn should_override_system_dns(tun_enabled: bool, override_system_dns: bool) -> bool {
    tun_enabled && override_system_dns
}

fn copy_core_runtime_files(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    for file in CORE_RUNTIME_FILE_NAMES {
        let source = source_dir.join(file);
        if !source.is_file() {
            continue;
        }
        fs::copy(&source, target_dir.join(file))
            .map_err(|error| format!("复制 TUN 运行资源“{file}”失败：{error}"))?;
    }
    Ok(())
}

fn validate_service_config(content: &str) -> Result<bool, String> {
    if content.len() > MAX_CONFIG_BYTES {
        return Err("Mihomo 配置超过 8 MB 限制".into());
    }
    let value = serde_yaml::from_str::<serde_yaml::Value>(content)
        .map_err(|error| format!("Mihomo 配置格式无效：{error}"))?;
    let mapping = value
        .as_mapping()
        .ok_or_else(|| "Mihomo 配置根节点必须是对象".to_string())?;
    let tun_enabled = mapping
        .get(serde_yaml::Value::String("tun".into()))
        .and_then(serde_yaml::Value::as_mapping)
        .and_then(|tun| tun.get(serde_yaml::Value::String("enable".into())))
        .and_then(serde_yaml::Value::as_bool)
        .unwrap_or(false);
    for forbidden in ["external-ui", "external-ui-url"] {
        if mapping.contains_key(serde_yaml::Value::String(forbidden.into())) {
            return Err(format!("特权 TUN 配置不允许使用 {forbidden}"));
        }
    }
    validate_provider_paths(mapping, "proxy-providers")?;
    validate_provider_paths(mapping, "rule-providers")?;
    Ok(tun_enabled)
}

fn validate_provider_paths(root: &serde_yaml::Mapping, section: &str) -> Result<(), String> {
    let Some(providers) = root
        .get(serde_yaml::Value::String(section.into()))
        .and_then(serde_yaml::Value::as_mapping)
    else {
        return Ok(());
    };
    for provider in providers.values().filter_map(serde_yaml::Value::as_mapping) {
        let Some(path) = provider
            .get(serde_yaml::Value::String("path".into()))
            .and_then(serde_yaml::Value::as_str)
        else {
            continue;
        };
        let normalized = path.trim_start_matches("./");
        let validated = validate_relative_path(normalized)?;
        if validated.components().next() != Some(Component::Normal("subscriptions".as_ref())) {
            return Err(format!("特权 TUN 配置中的 Provider 路径不受信任：{path}"));
        }
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("服务运行文件路径不安全：{value}"));
    }
    Ok(path.to_path_buf())
}

fn read_daemon_config() -> Result<TunServiceDaemonConfig, String> {
    let content = fs::read_to_string(service_config_path())
        .map_err(|error| format!("读取系统服务配置失败：{error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("解析系统服务配置失败：{error}"))
}

fn install_elevated(client_config_path: &Path, source_core: &Path) -> Result<(), String> {
    let client_content = fs::read_to_string(client_config_path)
        .map_err(|error| format!("读取待安装服务配置失败：{error}"))?;
    let client: TunServiceClientConfig = serde_json::from_str(&client_content)
        .map_err(|error| format!("解析待安装服务配置失败：{error}"))?;
    if client.version != SERVICE_VERSION || client.port != SERVICE_PORT {
        return Err("待安装服务配置与当前应用版本不一致".into());
    }
    let source_executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = service_executable_path();
    let core_path = service_core_path();
    let data_dir = service_data_dir();
    if let Some(parent) = executable.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    fs::copy(source_executable, &executable)
        .map_err(|error| format!("安装 TUN 服务程序失败：{error}"))?;
    fs::copy(source_core, &core_path)
        .map_err(|error| format!("安装受保护的 Mihomo 内核失败：{error}"))?;
    #[cfg(windows)]
    protect_windows_service_directory()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
        fs::set_permissions(&core_path, fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }

    write_private_json(
        &service_config_path(),
        &TunServiceDaemonConfig {
            token: client.token,
            version: SERVICE_VERSION.into(),
            core_path,
            data_dir,
        },
    )?;
    #[cfg(unix)]
    protect_unix_service_directory()?;
    register_platform_service(&executable)
}

#[cfg(unix)]
fn protect_unix_service_directory() -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let directory = service_install_dir();
    let owner = if cfg!(target_os = "macos") {
        "root:wheel"
    } else {
        "root:root"
    };
    let directory_text = directory.to_string_lossy().into_owned();
    run_checked(
        Command::new("chown").args(["-R", owner, directory_text.as_str()]),
        "保护 TUN 服务文件所有权",
    )?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("保护 TUN 服务目录权限失败：{error}"))?;
    fs::set_permissions(service_executable_path(), fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("保护 TUN 服务程序权限失败：{error}"))?;
    fs::set_permissions(service_core_path(), fs::Permissions::from_mode(0o755))
        .map_err(|error| format!("保护 Mihomo 内核权限失败：{error}"))?;
    fs::set_permissions(service_config_path(), fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("保护 TUN 服务令牌权限失败：{error}"))
}

#[cfg(windows)]
fn protect_windows_service_directory() -> Result<(), String> {
    let directory = service_install_dir().to_string_lossy().into_owned();
    run_checked(
        Command::new("icacls.exe").args([
            &directory,
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
        ]),
        "保护 Windows TUN 服务目录",
    )
}

fn uninstall_elevated() -> Result<(), String> {
    unregister_platform_service()?;
    restore_system_dns()?;
    let directory = service_install_dir();
    for attempt in 0..20 {
        if !directory.exists() {
            return Ok(());
        }
        match fs::remove_dir_all(&directory) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 19 => thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(format!("删除系统服务文件失败：{error}")),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn service_install_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into()))
        .join("ClashMG")
        .join("TunService")
}

#[cfg(target_os = "macos")]
fn service_install_dir() -> PathBuf {
    PathBuf::from("/Library/Application Support/com.clashmg.desktop/TunService")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn service_install_dir() -> PathBuf {
    PathBuf::from("/var/lib/clash-mg/tun-service")
}

#[cfg(windows)]
fn service_executable_path() -> PathBuf {
    service_install_dir().join("clash-mg-tun-service.exe")
}

#[cfg(not(windows))]
fn service_executable_path() -> PathBuf {
    service_install_dir().join("clash-mg-tun-service")
}

#[cfg(windows)]
fn service_core_path() -> PathBuf {
    service_install_dir().join("mihomo.exe")
}

#[cfg(not(windows))]
fn service_core_path() -> PathBuf {
    service_install_dir().join("mihomo")
}

fn service_config_path() -> PathBuf {
    service_install_dir().join("service.json")
}

fn service_data_dir() -> PathBuf {
    service_install_dir().join("runtime")
}

fn runtime_state_path() -> PathBuf {
    service_data_dir().join(RUNTIME_STATE_NAME)
}

#[cfg(target_os = "macos")]
fn apply_system_dns_override() -> Result<(), String> {
    macos_system_dns::apply()
}

#[cfg(not(target_os = "macos"))]
fn apply_system_dns_override() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_system_dns() -> Result<(), String> {
    macos_system_dns::restore()
}

#[cfg(not(target_os = "macos"))]
fn restore_system_dns() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_system_dns {
    use std::{net::IpAddr, process::Command};

    use serde::{Deserialize, Serialize};

    use super::*;

    const NETWORK_SETUP: &str = "/usr/sbin/networksetup";
    const DNS_BACKUP_NAME: &str = "system-dns-backup.json";
    const TUN_DNS_SERVER: &str = "198.18.0.2";

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct DnsServiceBackup {
        service: String,
        servers: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DnsBackup {
        services: Vec<DnsServiceBackup>,
    }

    pub fn apply() -> Result<(), String> {
        let backup_path = backup_path();
        if backup_path.is_file() {
            restore()?;
        }

        let services = list_enabled_services()?;
        if services.is_empty() {
            return Err("未找到可接管 DNS 的 macOS 网络服务".into());
        }
        let backup = DnsBackup {
            services: services
                .into_iter()
                .map(|service| {
                    let servers = read_dns_servers(&service)?;
                    Ok(DnsServiceBackup { service, servers })
                })
                .collect::<Result<Vec<_>, String>>()?,
        };
        write_private_json(&backup_path, &backup)
            .map_err(|error| format!("保存 macOS 系统 DNS 备份失败：{error}"))?;

        for service in &backup.services {
            if let Err(error) = set_dns_servers(&service.service, &[TUN_DNS_SERVER.into()])
                .and_then(|_| verify_dns_override(&service.service))
            {
                let rollback = restore();
                return Err(match rollback {
                    Ok(()) => format!("{error}；已恢复原系统 DNS"),
                    Err(rollback_error) => {
                        format!("{error}；恢复原系统 DNS 失败：{rollback_error}")
                    }
                });
            }
        }
        Ok(())
    }

    pub fn restore() -> Result<(), String> {
        let path = backup_path();
        if !path.is_file() {
            return Ok(());
        }
        let content = fs::read(&path).map_err(|error| format!("读取系统 DNS 备份失败：{error}"))?;
        let backup = serde_json::from_slice::<DnsBackup>(&content)
            .map_err(|error| format!("解析系统 DNS 备份失败：{error}"))?;
        let mut errors = Vec::new();
        for service in backup.services {
            if let Err(error) = set_dns_servers(&service.service, &service.servers)
                .and_then(|_| verify_dns_servers(&service.service, &service.servers))
            {
                errors.push(error);
            }
        }
        if !errors.is_empty() {
            return Err(errors.join("；"));
        }
        fs::remove_file(path).map_err(|error| format!("删除系统 DNS 备份失败：{error}"))
    }

    fn backup_path() -> PathBuf {
        service_data_dir().join(DNS_BACKUP_NAME)
    }

    fn list_enabled_services() -> Result<Vec<String>, String> {
        let output = run_networksetup(&["-listnetworkserviceorder".into()])?;
        let mut services = output
            .lines()
            .filter_map(parse_service_order_line)
            .collect::<Vec<_>>();
        services.sort();
        services.dedup();
        Ok(services)
    }

    fn parse_service_order_line(line: &str) -> Option<String> {
        let line = line.trim();
        if !line.starts_with('(') {
            return None;
        }
        let (_, service) = line.split_once(") ")?;
        let service = service.trim();
        if service.is_empty() || service.starts_with('*') {
            None
        } else {
            Some(service.into())
        }
    }

    fn read_dns_servers(service: &str) -> Result<Vec<String>, String> {
        let output = run_networksetup(&["-getdnsservers".into(), service.into()])?;
        Ok(parse_dns_servers(&output))
    }

    fn parse_dns_servers(output: &str) -> Vec<String> {
        output
            .lines()
            .map(str::trim)
            .filter(|value| value.parse::<IpAddr>().is_ok())
            .map(str::to_string)
            .collect()
    }

    fn set_dns_servers(service: &str, servers: &[String]) -> Result<(), String> {
        let mut arguments = vec!["-setdnsservers".into(), service.into()];
        if servers.is_empty() {
            arguments.push("Empty".into());
        } else {
            arguments.extend(servers.iter().cloned());
        }
        run_networksetup(&arguments).map(|_| ())
    }

    fn verify_dns_override(service: &str) -> Result<(), String> {
        verify_dns_servers(service, &[TUN_DNS_SERVER.into()])
    }

    fn verify_dns_servers(service: &str, expected: &[String]) -> Result<(), String> {
        let actual = read_dns_servers(service)?;
        if actual == expected {
            Ok(())
        } else {
            Err(format!(
                "macOS 网络服务“{service}”未接受 DNS 设置，当前值：{}",
                actual.join(", ")
            ))
        }
    }

    fn run_networksetup(arguments: &[String]) -> Result<String, String> {
        let output = Command::new(NETWORK_SETUP)
            .args(arguments)
            .output()
            .map_err(|error| format!("执行 macOS DNS 配置命令失败：{error}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            Err(format!("配置 macOS 系统 DNS 失败：{detail}"))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_enabled_network_services_only() {
            let output = "An asterisk (*) denotes that a network service is disabled.\n(1) Wi-Fi\n(Hardware Port: Wi-Fi, Device: en0)\n(2) *Thunderbolt Bridge\n(Hardware Port: Thunderbolt Bridge, Device: bridge0)\n(3) USB 10/100/1000 LAN\n";
            let services = output
                .lines()
                .filter_map(parse_service_order_line)
                .collect::<Vec<_>>();
            assert_eq!(services, ["Wi-Fi", "USB 10/100/1000 LAN"]);
        }

        #[test]
        fn parses_only_valid_dns_addresses() {
            assert_eq!(
                parse_dns_servers("1.1.1.1\n2606:4700:4700::1111\n"),
                ["1.1.1.1", "2606:4700:4700::1111"]
            );
            assert!(parse_dns_servers("There aren't any DNS Servers set.\n").is_empty());
        }
    }
}

#[cfg(windows)]
fn register_platform_service(executable: &Path) -> Result<(), String> {
    let bin_path = format!("\"{}\" --tun-service", executable.to_string_lossy());
    run_checked(
        Command::new("sc.exe").args([
            "create",
            SERVICE_NAME,
            "binPath=",
            &bin_path,
            "start=",
            "auto",
            "DisplayName=",
            "Clash MG Mihomo Service",
        ]),
        "创建 Windows TUN 服务",
    )?;
    let _ = run_checked(
        Command::new("sc.exe").args([
            "description",
            SERVICE_NAME,
            "以系统权限常驻运行 Mihomo，并提供 TUN 网络能力",
        ]),
        "设置 Windows TUN 服务说明",
    );
    run_checked(
        Command::new("sc.exe").args(["start", SERVICE_NAME]),
        "启动 Windows TUN 服务",
    )
}

#[cfg(target_os = "macos")]
fn register_platform_service(executable: &Path) -> Result<(), String> {
    let plist_path = PathBuf::from(format!("/Library/LaunchDaemons/{SERVICE_LABEL}.plist"));
    let plist = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>{SERVICE_LABEL}</string><key>ProgramArguments</key><array><string>{}</string><string>--tun-service</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n",
        xml_escape(&executable.to_string_lossy()),
    );
    fs::write(&plist_path, plist).map_err(|error| format!("写入 launchd 配置失败：{error}"))?;
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("system/{SERVICE_LABEL}")])
        .status();
    run_checked(
        Command::new("launchctl").args(["bootstrap", "system", &plist_path.to_string_lossy()]),
        "注册 macOS TUN 服务",
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn register_platform_service(executable: &Path) -> Result<(), String> {
    let unit_path = PathBuf::from("/etc/systemd/system/clash-mg-tun.service");
    let unit = format!(
        "[Unit]\nDescription=Clash MG Mihomo Service\nAfter=network.target\n\n[Service]\nType=simple\nExecStart={} --tun-service\nRestart=on-failure\nNoNewPrivileges=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths={}\n\n[Install]\nWantedBy=multi-user.target\n",
        executable.to_string_lossy(),
        service_install_dir().to_string_lossy(),
    );
    fs::write(unit_path, unit).map_err(|error| format!("写入 systemd 服务失败：{error}"))?;
    run_checked(
        Command::new("systemctl").args(["daemon-reload"]),
        "刷新 systemd 配置",
    )?;
    run_checked(
        Command::new("systemctl").args(["enable", "--now", "clash-mg-tun.service"]),
        "启用 Linux TUN 服务",
    )
}

#[cfg(windows)]
fn unregister_platform_service() -> Result<(), String> {
    if !platform_service_registered() {
        return Ok(());
    }
    let _ = Command::new("sc.exe").args(["stop", SERVICE_NAME]).status();
    for _ in 0..30 {
        let output = Command::new("sc.exe")
            .args(["query", SERVICE_NAME])
            .output();
        if output
            .as_ref()
            .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains("STOPPED"))
        {
            break;
        }
        thread::sleep(Duration::from_millis(200));
    }
    run_checked(
        Command::new("sc.exe").args(["delete", SERVICE_NAME]),
        "删除 Windows TUN 服务",
    )
}

#[cfg(windows)]
fn platform_service_registered() -> bool {
    let mut command = Command::new("sc.exe");
    command.args(["query", SERVICE_NAME]);
    command.creation_flags(CREATE_NO_WINDOW);
    command.status().is_ok_and(|status| status.success())
}

#[cfg(target_os = "macos")]
fn platform_service_registered() -> bool {
    Path::new(&format!("/Library/LaunchDaemons/{SERVICE_LABEL}.plist")).is_file()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_service_registered() -> bool {
    Path::new("/etc/systemd/system/clash-mg-tun.service").is_file()
}

#[cfg(target_os = "macos")]
fn unregister_platform_service() -> Result<(), String> {
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("system/{SERVICE_LABEL}")])
        .status();
    let plist_path = PathBuf::from(format!("/Library/LaunchDaemons/{SERVICE_LABEL}.plist"));
    if plist_path.exists() {
        fs::remove_file(plist_path).map_err(|error| format!("删除 launchd 配置失败：{error}"))?;
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn unregister_platform_service() -> Result<(), String> {
    let _ = Command::new("systemctl")
        .args(["disable", "--now", "clash-mg-tun.service"])
        .status();
    let unit_path = PathBuf::from("/etc/systemd/system/clash-mg-tun.service");
    if unit_path.exists() {
        fs::remove_file(unit_path).map_err(|error| format!("删除 systemd 服务失败：{error}"))?;
    }
    run_checked(
        Command::new("systemctl").args(["daemon-reload"]),
        "刷新 systemd 配置",
    )
}

fn run_checked(command: &mut Command, action: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|error| format!("{action}失败：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        let fallback = String::from_utf8_lossy(&output.stdout);
        let detail = if detail.trim().is_empty() {
            fallback.trim()
        } else {
            detail.trim()
        };
        Err(format!("{action}失败：{detail}"))
    }
}

#[cfg(windows)]
fn run_elevated(arguments: &[String]) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let argument_list = arguments
        .iter()
        .map(|argument| format!("'\"{}\"'", argument.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "$process = Start-Process -FilePath '{}' -ArgumentList @({argument_list}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode",
        executable.to_string_lossy().replace('\'', "''"),
    );
    run_checked(
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ]),
        "请求管理员权限",
    )
}

#[cfg(target_os = "macos")]
fn run_elevated(arguments: &[String]) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let command = std::iter::once(executable.to_string_lossy().into_owned())
        .chain(arguments.iter().cloned())
        .map(|value| shell_quote(&value))
        .collect::<Vec<_>>()
        .join(" ");
    let apple_script = format!(
        "do shell script \"{}\" with administrator privileges",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    run_checked(
        Command::new("osascript").args(["-e", &apple_script]),
        "请求管理员权限",
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_elevated(arguments: &[String]) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    run_checked(
        Command::new("pkexec").arg(executable).args(arguments),
        "请求管理员权限",
    )
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(windows)]
mod windows_service_host {
    use super::*;
    use std::{ffi::OsString, sync::mpsc};
    use windows_service::{
        define_windows_service,
        service::{
            ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
            ServiceType,
        },
        service_control_handler::{self, ServiceControlHandlerResult},
        service_dispatcher,
    };

    define_windows_service!(ffi_service_main, service_main);

    pub fn run() -> Result<(), String> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)
            .map_err(|error| format!("启动 Windows 服务调度器失败：{error}"))
    }

    fn service_main(_: Vec<OsString>) {
        if let Err(error) = run_inner() {
            eprintln!("{error}");
        }
    }

    fn run_inner() -> Result<(), String> {
        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let event_handler = move |control_event| match control_event {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        };
        let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)
            .map_err(|error| error.to_string())?;
        status_handle
            .set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: ServiceState::Running,
                controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint: Duration::default(),
                process_id: None,
            })
            .map_err(|error| error.to_string())?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_watcher = Arc::clone(&stop);
        thread::spawn(move || {
            let _ = shutdown_rx.recv();
            stop_watcher.store(true, Ordering::Relaxed);
        });
        let result = run_service_loop(stop);

        let _ = status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(if result.is_ok() { 0 } else { 1 }),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        });
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_non_tun_service_config_without_requesting_tun_privileges() {
        assert_eq!(
            validate_service_config("tun:\n  enable: false\n"),
            Ok(false)
        );
    }

    #[test]
    fn accepts_tun_config_with_safe_subscription_provider() {
        let config = "tun:\n  enable: true\nproxy-providers:\n  demo:\n    type: file\n    path: ./subscriptions/demo.yaml\n";
        assert_eq!(validate_service_config(config), Ok(true));
    }

    #[test]
    fn overrides_system_dns_only_when_tun_and_dns_override_are_enabled() {
        assert!(should_override_system_dns(true, true));
        assert!(!should_override_system_dns(true, false));
        assert!(!should_override_system_dns(false, true));
        assert!(!should_override_system_dns(false, false));
    }

    #[test]
    fn rejects_privileged_provider_path_escape() {
        let config = "tun:\n  enable: true\nproxy-providers:\n  demo:\n    type: file\n    path: ../../etc/shadow\n";
        assert!(validate_service_config(config).is_err());
    }

    #[test]
    fn copies_meta_database_required_by_current_mihomo() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix 纪元")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "clash-mg-tun-runtime-copy-{}-{unique}",
            std::process::id()
        ));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source).expect("应创建测试源目录");
        fs::create_dir_all(&target).expect("应创建测试目标目录");
        fs::write(source.join("geoip.metadb"), b"meta database").expect("应写入测试 MetaDB");

        copy_core_runtime_files(&source, &target).expect("应复制 TUN 运行资源");

        assert_eq!(
            fs::read(target.join("geoip.metadb")).expect("应读取复制后的 MetaDB"),
            b"meta database"
        );
        fs::remove_dir_all(root).expect("应清理测试目录");
    }

    #[test]
    fn accepted_connection_waits_for_delayed_request_data() {
        let listener = match TcpListener::bind(("127.0.0.1", 0)) {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(error) => panic!("应创建测试监听器：{error}"),
        };
        listener.set_nonblocking(true).expect("应设置非阻塞监听器");
        let address = listener.local_addr().expect("应读取监听地址");
        let reader = thread::spawn(move || loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    configure_accepted_stream(&stream).expect("应恢复已接受连接的阻塞模式");
                    let mut line = String::new();
                    BufReader::new(stream)
                        .read_line(&mut line)
                        .expect("应等待并读取延迟到达的数据");
                    return line;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("接受测试连接失败：{error}"),
            }
        });

        let mut client = TcpStream::connect(address).expect("应连接测试服务");
        thread::sleep(Duration::from_millis(50));
        client.write_all(b"delayed\n").expect("应发送延迟数据");
        assert_eq!(reader.join().expect("读取线程应正常结束"), "delayed\n");
    }
}
