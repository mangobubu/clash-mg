use std::{
    env, fs,
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Stdio,
};

use chrono::{DateTime, Local};

use crate::models::{LogEntry, SettingsMap};

pub const LOG_TAIL_MAX_BYTES: u64 = 1024 * 1024;
const DEFAULT_MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreLogOptions {
    pub enabled: bool,
    pub path: PathBuf,
    pub rotate: bool,
    pub max_bytes: u64,
}

pub fn options_from_settings(data_dir: &Path, settings: &SettingsMap) -> CoreLogOptions {
    let raw_path = setting_string(settings, "logPath", "~/logs/clash-mg/app.log");
    CoreLogOptions {
        enabled: setting_bool(settings, "logToFile", true),
        path: resolve_log_path(data_dir, &raw_path),
        rotate: setting_bool(settings, "rotateLogs", true),
        max_bytes: parse_log_size(
            &setting_string(settings, "maxLogSize", "10 MB"),
            DEFAULT_MAX_LOG_BYTES,
        ),
    }
}

pub fn open_log_stdio(options: &CoreLogOptions) -> Result<(Stdio, Stdio), String> {
    if !options.enabled {
        return Ok((Stdio::null(), Stdio::null()));
    }

    if let Some(parent) = options.path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 Mihomo 日志目录失败：{error}"))?;
    }
    rotate_log_if_needed(options)?;

    let output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&options.path)
        .map_err(|error| format!("打开 Mihomo 日志文件失败：{error}"))?;
    let error_output = output
        .try_clone()
        .map_err(|error| format!("复用 Mihomo 日志文件失败：{error}"))?;

    Ok((Stdio::from(output), Stdio::from(error_output)))
}

pub fn read_log_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("读取 Mihomo 日志失败：{error}"))?;
    let length = file
        .metadata()
        .map_err(|error| format!("读取 Mihomo 日志信息失败：{error}"))?
        .len();
    let start = length.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("定位 Mihomo 日志失败：{error}"))?;

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("解析 Mihomo 日志失败：{error}"))?;
    let mut content = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        content = content
            .split_once('\n')
            .map(|(_, remaining)| remaining.to_string())
            .unwrap_or_default();
    }
    Ok(content)
}

pub fn failure_entries(content: &str, limit: usize) -> Vec<LogEntry> {
    let mut entries = content
        .lines()
        .filter_map(parse_failure_entry)
        .collect::<Vec<_>>();
    entries.reverse();
    entries.truncate(limit);
    entries
}

fn rotate_log_if_needed(options: &CoreLogOptions) -> Result<(), String> {
    if !options.rotate
        || !options.path.is_file()
        || fs::metadata(&options.path)
            .map(|metadata| metadata.len() < options.max_bytes)
            .unwrap_or(true)
    {
        return Ok(());
    }

    let rotated = rotated_log_path(&options.path);
    if rotated.exists() {
        fs::remove_file(&rotated)
            .map_err(|error| format!("删除旧 Mihomo 轮转日志失败：{error}"))?;
    }
    fs::rename(&options.path, &rotated).map_err(|error| format!("轮转 Mihomo 日志失败：{error}"))
}

fn rotated_log_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".1");
    PathBuf::from(value)
}

fn resolve_log_path(data_dir: &Path, value: &str) -> PathBuf {
    let value = value.trim();
    if value == "~" {
        return home_dir().unwrap_or_else(|| data_dir.to_path_buf());
    }
    if let Some(relative) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home_dir()
            .unwrap_or_else(|| data_dir.to_path_buf())
            .join(relative);
    }

    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        data_dir.join(path)
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn parse_log_size(value: &str, fallback: u64) -> u64 {
    let normalized = value.trim().to_ascii_uppercase();
    let mut parts = normalized.split_whitespace();
    let Some(number) = parts.next().and_then(|part| part.parse::<u64>().ok()) else {
        return fallback;
    };
    let multiplier = match parts.next().unwrap_or("B") {
        "KB" | "KIB" => 1024,
        "MB" | "MIB" => 1024 * 1024,
        "GB" | "GIB" => 1024 * 1024 * 1024,
        "B" => 1,
        _ => return fallback,
    };
    number.saturating_mul(multiplier).max(1)
}

fn parse_failure_entry(line: &str) -> Option<LogEntry> {
    let level = field_value(line, "level=")?;
    let normalized_level = match level.trim_matches('"').to_ascii_lowercase().as_str() {
        "warning" | "warn" => "WARNING",
        "error" | "fatal" | "panic" => "ERROR",
        _ => return None,
    };
    let raw_message = line
        .split_once("msg=")
        .map(|(_, value)| value)
        .unwrap_or(line);
    let content = serde_json::from_str::<String>(raw_message).unwrap_or_else(|_| {
        raw_message
            .trim_matches('"')
            .replace("\\\"", "\"")
            .replace("\\n", "\n")
    });
    let raw_time = field_value(line, "time=").unwrap_or_default();
    let time = DateTime::parse_from_rfc3339(raw_time.trim_matches('"'))
        .map(|value| value.with_timezone(&Local).format("%H:%M:%S").to_string())
        .unwrap_or_else(|_| "--:--:--".into());

    Some(LogEntry {
        id: stable_id("mihomo-log", line),
        time,
        level: normalized_level.into(),
        source: "Mihomo".into(),
        content,
    })
}

fn field_value<'a>(line: &'a str, field: &str) -> Option<&'a str> {
    let value = line.split_once(field)?.1;
    if let Some(quoted) = value.strip_prefix('"') {
        return quoted.find('"').map(|end| &value[..end + 2]);
    }
    Some(value.split_whitespace().next().unwrap_or(value))
}

fn stable_id(prefix: &str, value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{prefix}-{hash:x}")
}

fn setting_string(settings: &SettingsMap, key: &str, fallback: &str) -> String {
    settings
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn setting_bool(settings: &SettingsMap, key: &str, fallback: bool) -> bool {
    settings
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_size_units() {
        assert_eq!(parse_log_size("5 MB", 1), 5 * 1024 * 1024);
        assert_eq!(parse_log_size("2 GB", 1), 2 * 1024 * 1024 * 1024);
        assert_eq!(parse_log_size("invalid", 7), 7);
    }

    #[test]
    fn builds_disabled_relative_log_options_from_settings() {
        let mut settings = crate::defaults::default_settings();
        settings.insert("logToFile".into(), serde_json::json!(false));
        settings.insert("logPath".into(), serde_json::json!("logs/core.log"));
        settings.insert("maxLogSize".into(), serde_json::json!("20 MB"));
        let data_dir = Path::new("/tmp/clash-mg-data");

        let options = options_from_settings(data_dir, &settings);

        assert!(!options.enabled);
        assert_eq!(options.path, data_dir.join("logs/core.log"));
        assert_eq!(options.max_bytes, 20 * 1024 * 1024);
    }

    #[test]
    fn parses_only_warning_and_error_entries() {
        let content = concat!(
            "time=\"2026-06-29T16:00:00+08:00\" level=info msg=\"connected\"\n",
            "time=\"2026-06-29T16:00:01+08:00\" level=warning msg=\"dial failed\"\n",
            "time=\"2026-06-29T16:00:02+08:00\" level=error msg=\"DNS failed\"\n",
        );
        let entries = failure_entries(content, 10);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, "ERROR");
        assert_eq!(entries[0].content, "DNS failed");
        assert_eq!(entries[1].level, "WARNING");
    }

    #[test]
    fn rotates_oversized_log_before_opening() {
        let directory = std::env::temp_dir().join(format!(
            "clash-mg-core-log-{}-{}",
            std::process::id(),
            stable_id("test", &Local::now().to_rfc3339())
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let path = directory.join("core.log");
        fs::write(&path, "oversized").expect("应写入测试日志");
        let options = CoreLogOptions {
            enabled: true,
            path: path.clone(),
            rotate: true,
            max_bytes: 4,
        };

        let _ = open_log_stdio(&options).expect("应打开轮转后的日志");

        assert_eq!(
            fs::read_to_string(rotated_log_path(&path)).unwrap(),
            "oversized"
        );
        assert!(path.is_file());
        let _ = fs::remove_dir_all(directory);
    }
}
