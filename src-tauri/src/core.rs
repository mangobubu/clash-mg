use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
    let core_dir = core_dir(&app)?;
    let mut command = Command::new(&executable);
    command
        .arg("-d")
        .arg(&core_dir)
        .arg("-f")
        .arg(&config_path)
        .current_dir(&core_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|error| format!("启动 Mihomo 内核失败：{error}"))?;

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

pub(crate) fn generated_config_content(settings: &SettingsMap) -> String {
    format!(
        "mixed-port: {}\nport: {}\nsocks-port: {}\nallow-lan: {}\nbind-address: {}\nmode: {}\nlog-level: {}\nexternal-controller: {}\nsecret: {}\nipv6: {}\nunified-delay: {}\nprofile:\n  store-selected: true\n  store-fake-ip: true\nproxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n",
        setting_number(settings, "mixedPort", 7890),
        setting_number(settings, "httpPort", 7892),
        setting_number(settings, "socksPort", 7891),
        setting_bool(settings, "allowLan", false),
        yaml_string(&setting_string(settings, "bindAddress", "0.0.0.0")),
        yaml_string(&map_mode(&setting_string(settings, "coreMode", "规则模式"))),
        yaml_string(&map_log_level(&setting_string(settings, "logLevel", "信息 (Info)"))),
        yaml_string(&controller_address(settings)),
        yaml_string(&setting_string(settings, "uiSecret", "")),
        setting_bool(settings, "coreIpv6", false),
        setting_bool(settings, "unifiedDelay", true),
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
