use crate::models::SettingsMap;

const RULE_NAME: &str = "Clash-MG Proxy Ports";

pub fn apply(settings: &SettingsMap, enabled: bool) -> Result<(), String> {
    apply_platform(settings, enabled)
}

fn proxy_ports(settings: &SettingsMap) -> Vec<u16> {
    let mut ports = ["mixedPort", "httpPort", "socksPort"]
        .into_iter()
        .filter_map(|key| {
            settings
                .get(key)
                .and_then(|value| value.as_u64())
                .and_then(|value| u16::try_from(value).ok())
                .filter(|value| *value > 0)
        })
        .collect::<Vec<_>>();
    ports.sort_unstable();
    ports.dedup();
    ports
}

#[cfg(windows)]
fn apply_platform(settings: &SettingsMap, enabled: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let ports = proxy_ports(settings)
        .into_iter()
        .map(|port| port.to_string())
        .collect::<Vec<_>>()
        .join(",");
    if enabled && ports.is_empty() {
        return Err("没有可用于防火墙规则的有效代理端口".into());
    }

    let script_path =
        std::env::temp_dir().join(format!("clash-mg-firewall-{}.cmd", std::process::id()));
    std::fs::write(&script_path, firewall_script(enabled, &ports))
        .map_err(|error| format!("创建防火墙配置脚本失败：{error}"))?;
    let script_path_arg = format!(
        "'\"{}\"'",
        script_path.display().to_string().replace('\'', "''")
    );
    let elevated_command = format!(
        "$process = Start-Process -FilePath cmd.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('/C',{script_path_arg}); exit $process.ExitCode"
    );
    let status = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &elevated_command,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("启动防火墙配置程序失败：{error}"));
    let _ = std::fs::remove_file(&script_path);
    let status = status?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "防火墙配置未完成，可能是管理员授权被取消（退出码：{}）",
            status.code().unwrap_or(-1)
        ))
    }
}

#[cfg(windows)]
fn firewall_script(enabled: bool, ports: &str) -> String {
    let delete = format!(
        "@echo off\r\nnetsh advfirewall firewall delete rule name=\"{RULE_NAME}\" >nul 2>&1\r\n"
    );
    if !enabled {
        return format!("{delete}exit /b 0\r\n");
    }
    format!(
        "{delete}netsh advfirewall firewall add rule name=\"{RULE_NAME}\" dir=in action=allow protocol=TCP localport={ports} >nul\r\nif errorlevel 1 exit /b %errorlevel%\r\nnetsh advfirewall firewall add rule name=\"{RULE_NAME}\" dir=in action=allow protocol=UDP localport={ports} >nul\r\nexit /b %errorlevel%\r\n"
    )
}

#[cfg(not(windows))]
fn apply_platform(_settings: &SettingsMap, enabled: bool) -> Result<(), String> {
    if enabled {
        Err("防火墙集成目前仅支持 Windows".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::proxy_ports;
    use crate::models::SettingsMap;

    #[test]
    fn collects_unique_valid_proxy_ports() {
        let settings = SettingsMap::from([
            ("mixedPort".into(), json!(7890)),
            ("httpPort".into(), json!(7892)),
            ("socksPort".into(), json!(7890)),
        ]);
        assert_eq!(proxy_ports(&settings), vec![7890, 7892]);
    }

    #[cfg(windows)]
    #[test]
    fn builds_single_elevated_firewall_script() {
        let script = super::firewall_script(true, "7890,7891");
        assert!(script.contains("protocol=TCP localport=7890,7891"));
        assert!(script.contains("protocol=UDP localport=7890,7891"));
        assert!(script.contains("exit /b %errorlevel%"));
    }
}
