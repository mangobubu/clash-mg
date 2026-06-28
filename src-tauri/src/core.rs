use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::{
    ffi::OsStr,
    os::windows::{ffi::OsStrExt, process::CommandExt},
    ptr,
};

use reqwest::{
    header::{ACCEPT, USER_AGENT},
    Client,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    defaults::value_to_string,
    mihomo,
    models::{AppSnapshot, SettingsMap},
    subscription,
};

const CORE_DIR_NAME: &str = "core";
const CORE_EXE_NAME: &str = "mihomo.exe";
const GENERATED_CONFIG_NAME: &str = "config.yaml";
const DOWNLOAD_EVENT: &str = "mihomo-core-download-progress";
const RELEASE_API_URL: &str = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";
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
    "coreIpv6",
    "unifiedDelay",
    "tunMode",
    "networkStack",
    "autoRoute",
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
const SW_HIDE: i32 = 0;

#[cfg(windows)]
const CP_OEMCP: u32 = 1;

#[cfg(windows)]
#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteW(
        hwnd: *mut core::ffi::c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show_command: i32,
    ) -> *mut core::ffi::c_void;
}

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
pub struct MihomoCoreStatus {
    pub exists: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MihomoCoreLaunchResult {
    pub started: bool,
    pub controller_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MihomoCoreDownloadProgress {
    pub status: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: u64,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub fn core_status(app: &AppHandle) -> Result<MihomoCoreStatus, String> {
    let path = core_executable_path(app)?;
    Ok(MihomoCoreStatus {
        exists: path.is_file(),
        path: path.to_string_lossy().to_string(),
    })
}

pub async fn start_core(
    app: AppHandle,
    snapshot: AppSnapshot,
) -> Result<MihomoCoreLaunchResult, String> {
    let settings = &snapshot.settings;
    let executable = core_executable_path(&app)?;
    if !executable.is_file() {
        return Err("Mihomo 内核不存在，请先完成下载".into());
    }

    if mihomo::controller_is_ready(settings).await {
        return Ok(MihomoCoreLaunchResult {
            started: false,
            controller_ready: true,
            message: "Mihomo 控制器已就绪".into(),
        });
    }

    let config_path = resolve_config_path(&app, &snapshot)?;
    spawn_core_process(&app, &config_path)?;

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

pub async fn download_core(app: AppHandle) -> Result<MihomoCoreStatus, String> {
    match download_core_inner(&app).await {
        Ok(status) => Ok(status),
        Err(error) => {
            emit_progress(&app, "failed", 0, None, 0, 0.0, Some(error.clone()));
            Err(error)
        }
    }
}

async fn download_core_inner(app: &AppHandle) -> Result<MihomoCoreStatus, String> {
    let core_dir = core_dir(app)?;
    fs::create_dir_all(&core_dir).map_err(|error| error.to_string())?;

    emit_progress(
        app,
        "resolving",
        0,
        None,
        0,
        0.0,
        Some("正在解析最新 Mihomo 版本".into()),
    );
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let asset = resolve_latest_windows_amd64_asset(&client).await?;

    let temp_zip = core_dir.join("mihomo.download.zip.tmp");
    let temp_exe = core_dir.join("mihomo.exe.tmp");
    let final_exe = core_executable_path(app)?;

    if temp_zip.exists() {
        fs::remove_file(&temp_zip).map_err(|error| error.to_string())?;
    }
    if temp_exe.exists() {
        fs::remove_file(&temp_exe).map_err(|error| error.to_string())?;
    }

    emit_progress(
        app,
        "downloading",
        0,
        None,
        0,
        0.0,
        Some(format!("正在下载 {}", asset.name)),
    );
    download_asset(app, &client, &asset.browser_download_url, &temp_zip).await?;

    emit_progress(
        app,
        "extracting",
        0,
        None,
        0,
        100.0,
        Some("正在解压 Mihomo 内核".into()),
    );
    extract_executable(&temp_zip, &temp_exe)?;

    if final_exe.exists() {
        fs::remove_file(&final_exe).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_exe, &final_exe).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&temp_zip);

    emit_progress(
        app,
        "completed",
        0,
        None,
        0,
        100.0,
        Some("Mihomo 内核下载完成".into()),
    );
    core_status(app)
}

async fn resolve_latest_windows_amd64_asset(client: &Client) -> Result<GithubAsset, String> {
    let release = client
        .get(RELEASE_API_URL)
        .header(USER_AGENT, "clash-mg")
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("读取 Mihomo Release 失败：{error}"))?;
    let status = release.status();
    if !status.is_success() {
        return Err(format!(
            "读取 Mihomo Release 失败：GitHub 返回 HTTP {status}"
        ));
    }

    let release = release
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("解析 Mihomo Release 失败：{error}"))?;

    release
        .assets
        .into_iter()
        .filter(|asset| is_windows_amd64_zip(&asset.name))
        .max_by_key(|asset| asset_score(&asset.name))
        .ok_or_else(|| "未找到适用于 Windows x64 的 Mihomo 下载包".into())
}

fn is_windows_amd64_zip(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("mihomo-windows-amd64-") && name.ends_with(".zip")
}

fn asset_score(name: &str) -> u8 {
    let name = name.to_ascii_lowercase();
    let mut score = 0;
    if !name.contains("compatible") {
        score += 10;
    }
    if !name.contains("-go") {
        score += 10;
    }
    if !name.contains("-v1-") && !name.contains("-v2-") && !name.contains("-v3-") {
        score += 10;
    }
    if name.starts_with("mihomo-windows-amd64-v") {
        score += 10;
    }
    score
}

async fn download_asset(
    app: &AppHandle,
    client: &Client,
    url: &str,
    target: &Path,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .header(USER_AGENT, "clash-mg")
        .send()
        .await
        .map_err(|error| format!("下载 Mihomo 内核失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载 Mihomo 内核失败：下载源返回 HTTP {status}"));
    }

    let total = response.content_length();
    let mut file = File::create(target).map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取 Mihomo 下载数据失败：{error}"))?
    {
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(200)
            || total.is_some_and(|value| downloaded >= value)
        {
            let elapsed = started_at.elapsed().as_secs_f64().max(0.001);
            let speed = (downloaded as f64 / elapsed) as u64;
            let percent = total
                .filter(|value| *value > 0)
                .map(|value| downloaded as f64 / value as f64 * 100.0)
                .unwrap_or(0.0);
            emit_progress(app, "downloading", downloaded, total, speed, percent, None);
            last_emit = Instant::now();
        }
    }

    file.flush().map_err(|error| error.to_string())?;
    Ok(())
}

fn extract_executable(zip_path: &Path, executable_path: &Path) -> Result<(), String> {
    let zip_file = File::open(zip_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_dir() || !entry.name().to_ascii_lowercase().ends_with(".exe") {
            continue;
        }

        let mut executable = File::create(executable_path).map_err(|error| error.to_string())?;
        io::copy(&mut entry, &mut executable).map_err(|error| error.to_string())?;
        executable.flush().map_err(|error| error.to_string())?;
        return Ok(());
    }

    Err("Mihomo 下载包中没有找到可执行文件".into())
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

    previous_local_groups.len() != current_local_groups.len()
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
                })
        })
        || previous.proxy_group_overrides != current.proxy_group_overrides
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

    if mihomo::controller_is_ready(&snapshot.settings).await {
        let controller = mihomo::MihomoClient::from_settings(&snapshot.settings)
            .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
        let mut elevated_restart_completed = false;
        if tun_changed {
            fs::write(&path, &content).map_err(|error| format!("保存运行配置失败：{error}"))?;
            let restart_result = controller.restart_config(&content).await;
            tokio::time::sleep(Duration::from_millis(300)).await;
            if !wait_controller_ready(&snapshot.settings).await {
                let rollback =
                    rollback_runtime_config(&controller, &path, previous_content.as_deref(), true)
                        .await;
                let error = match restart_result {
                    Ok(()) => "Mihomo 重启后控制器未就绪；已尝试恢复上次配置".into(),
                    Err(error) => {
                        format!("重启 Mihomo 以切换 TUN 失败：{error}；已尝试恢复上次配置")
                    }
                };
                return Err(match rollback {
                    Ok(()) => error,
                    Err(rollback_error) => format!("{error}；恢复失败：{rollback_error}"),
                });
            }
        } else {
            if let Err(error) = controller.reload_config(&content).await {
                if expected_tun {
                    restart_core_elevated(app, snapshot, previous_content.as_deref()).await?;
                    elevated_restart_completed = true;
                } else {
                    return Err(format!("应用运行配置失败：{error}"));
                }
            }
        }
        let mut actual_tun = controller.runtime_tun_enabled().await;
        if expected_tun && matches!(actual_tun, Ok(false)) && !elevated_restart_completed {
            restart_core_elevated(app, snapshot, previous_content.as_deref()).await?;
            actual_tun = controller.runtime_tun_enabled().await;
        }
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
            let rollback = rollback_runtime_config(
                &controller,
                &path,
                previous_content.as_deref(),
                tun_changed,
            )
            .await;
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

fn spawn_core_process(app: &AppHandle, config_path: &Path) -> Result<(), String> {
    let executable = core_executable_path(app)?;
    let directory = core_dir(app)?;
    let mut command = Command::new(executable);
    command
        .arg("-d")
        .arg(&directory)
        .arg("-f")
        .arg(config_path)
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 Mihomo 内核失败：{error}"))
}

#[cfg(windows)]
async fn restart_core_elevated(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    previous_content: Option<&str>,
) -> Result<(), String> {
    let config_path = core_dir(app)?.join(GENERATED_CONFIG_NAME);
    let pid = controller_process_id(&snapshot.settings)?;
    stop_process(pid)?;

    let executable = core_executable_path(app)?;
    let directory = core_dir(app)?;
    let parameters = format!(
        "-d {} -f {}",
        quote_windows_argument(&directory.to_string_lossy()),
        quote_windows_argument(&config_path.to_string_lossy()),
    );
    let operation = wide_string("runas");
    let executable = wide_os_string(executable.as_os_str());
    let parameters = wide_string(&parameters);
    let directory_wide = wide_os_string(directory.as_os_str());
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            executable.as_ptr(),
            parameters.as_ptr(),
            directory_wide.as_ptr(),
            SW_HIDE,
        )
    } as isize;
    if result <= 32 {
        restore_non_tun_core(app, snapshot, &config_path, previous_content).await;
        return Err(if result == 5 {
            "开启 TUN 需要管理员权限；已取消提权并恢复原运行配置".into()
        } else {
            format!("以管理员权限启动 Mihomo 失败（错误码 {result}）；已恢复原运行配置")
        });
    }

    if !wait_controller_ready(&snapshot.settings).await {
        restore_non_tun_core(app, snapshot, &config_path, previous_content).await;
        return Err("管理员权限下的 Mihomo 未能就绪；已恢复原运行配置".into());
    }
    if !mihomo::MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?
        .runtime_tun_enabled()
        .await?
    {
        restore_non_tun_core(app, snapshot, &config_path, previous_content).await;
        return Err("管理员权限下的 Mihomo 仍未启用 TUN；已恢复原运行配置".into());
    }
    Ok(())
}

#[cfg(windows)]
async fn restore_non_tun_core(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    config_path: &Path,
    previous_content: Option<&str>,
) {
    if let Some(previous) = previous_content {
        let _ = fs::write(config_path, previous);
    }
    if spawn_core_process(app, config_path).is_ok() {
        let _ = wait_controller_ready(&snapshot.settings).await;
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

#[cfg(windows)]
fn quote_windows_argument(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(windows)]
fn wide_string(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn wide_os_string(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

#[cfg(not(windows))]
async fn restart_core_elevated(
    _: &AppHandle,
    _: &AppSnapshot,
    _: Option<&str>,
) -> Result<(), String> {
    Err("当前平台不支持通过提权启动 TUN".into())
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
        setting_bool(settings, "coreIpv6", false),
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

pub(crate) fn core_executable_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(core_dir(app)?.join(CORE_EXE_NAME))
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

fn emit_progress(
    app: &AppHandle,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_second: u64,
    percent: f64,
    message: Option<String>,
) {
    let _ = app.emit(
        DOWNLOAD_EVENT,
        MihomoCoreDownloadProgress {
            status: status.into(),
            downloaded_bytes,
            total_bytes,
            speed_bytes_per_second,
            percent: percent.clamp(0.0, 100.0),
            message,
        },
    );
}
