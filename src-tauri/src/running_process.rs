use serde::Serialize;
use std::{path::Path, process::Command};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcess {
    pub name: String,
    pub path: String,
}

pub fn list() -> Result<Vec<RunningProcess>, String> {
    let mut processes = list_platform_processes()?;
    processes
        .sort_by_cached_key(|process| (process.name.to_lowercase(), process.path.to_lowercase()));
    processes.dedup_by(|current, next| {
        current.name.to_lowercase() == next.name.to_lowercase()
            && current.path.to_lowercase() == next.path.to_lowercase()
    });
    Ok(processes)
}

fn normalize_process(name: &str, path: &str) -> Option<RunningProcess> {
    let path = path.trim();
    let fallback_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let name = name.trim();
    let name = if name.is_empty() { fallback_name } else { name };
    if name.is_empty() || name == "<defunct>" || (name.starts_with('[') && name.ends_with(']')) {
        return None;
    }

    Some(RunningProcess {
        name: name.to_string(),
        path: path.to_string(),
    })
}

#[cfg(unix)]
fn list_platform_processes() -> Result<Vec<RunningProcess>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .map_err(|error| format!("读取运行进程失败：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "读取运行进程失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_unix_process)
        .collect())
}

#[cfg(unix)]
fn parse_unix_process(line: &str) -> Option<RunningProcess> {
    let line = line.trim();
    let separator = line.find(char::is_whitespace)?;
    let pid = line[..separator].parse::<u32>().ok()?;
    let command = line[separator..].trim();
    if command.is_empty() {
        return None;
    }

    let path = resolve_unix_process_path(pid, command);
    let name = Path::new(command)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(command);
    normalize_process(name, &path)
}

#[cfg(unix)]
fn resolve_unix_process_path(pid: u32, command: &str) -> String {
    #[cfg(target_os = "linux")]
    if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/exe")) {
        return path.to_string_lossy().into_owned();
    }

    #[cfg(not(target_os = "linux"))]
    let _ = pid;

    if Path::new(command).is_absolute() {
        command.to_string()
    } else {
        String::new()
    }
}

#[cfg(windows)]
fn list_platform_processes() -> Result<Vec<RunningProcess>, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let script = r#"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { Write-Output ("{0}`t{1}" -f $_.Name, $_.ExecutablePath) }"#;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("读取运行进程失败：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "读取运行进程失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_windows_process)
        .collect())
}

#[cfg(windows)]
fn parse_windows_process(line: &str) -> Option<RunningProcess> {
    let (name, path) = line.trim().split_once('\t').unwrap_or((line.trim(), ""));
    normalize_process(name, path)
}

#[cfg(not(any(unix, windows)))]
fn list_platform_processes() -> Result<Vec<RunningProcess>, String> {
    Err("当前平台暂不支持读取运行进程".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_process_name_from_path() {
        assert_eq!(
            normalize_process("", "/Applications/Example.app/Contents/MacOS/Example"),
            Some(RunningProcess {
                name: "Example".into(),
                path: "/Applications/Example.app/Contents/MacOS/Example".into(),
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn parses_unix_process_with_spaces_in_path() {
        let process =
            parse_unix_process("123 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
                .expect("应解析进程");
        assert_eq!(process.name, "Google Chrome");
        assert_eq!(
            process.path,
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        );
    }

    #[cfg(windows)]
    #[test]
    fn parses_windows_process_name_and_path() {
        assert_eq!(
            parse_windows_process("chrome.exe\tC:\\Apps\\chrome.exe"),
            Some(RunningProcess {
                name: "chrome.exe".into(),
                path: "C:\\Apps\\chrome.exe".into(),
            })
        );
    }
}
