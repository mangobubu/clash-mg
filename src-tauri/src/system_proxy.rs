#[cfg(windows)]
mod windows {
    use std::{fs, io, path::PathBuf, ptr};

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Manager};
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    const INTERNET_SETTINGS_KEY: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const BACKUP_FILE_NAME: &str = "system-proxy-backup.json";
    const INTERNET_OPTION_REFRESH: u32 = 37;
    const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;

    #[link(name = "wininet")]
    unsafe extern "system" {
        fn InternetSetOptionW(
            internet: *mut core::ffi::c_void,
            option: u32,
            buffer: *mut core::ffi::c_void,
            buffer_length: u32,
        ) -> i32;
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProxyBackup {
        proxy_enable: Option<u32>,
        proxy_server: Option<String>,
        proxy_override: Option<String>,
        auto_config_url: Option<String>,
        auto_detect: Option<u32>,
    }

    pub fn apply(app: &AppHandle, enabled: bool, mixed_port: u16) -> Result<(), String> {
        let settings = internet_settings()?;
        let backup_path = backup_path(app)?;

        if enabled {
            if !backup_path.is_file() {
                save_backup(&backup_path, &capture_backup(&settings))?;
            }
            if let Err(error) = enable_proxy(&settings, mixed_port)
                .and_then(|_| verify_enabled(&settings, mixed_port))
            {
                let rollback = restore_from_path(&settings, &backup_path);
                return Err(with_rollback(error, rollback));
            }
        } else if backup_path.is_file() {
            restore_from_path(&settings, &backup_path)?;
            fs::remove_file(&backup_path)
                .map_err(|error| format!("删除系统代理备份失败：{error}"))?;
        } else {
            settings
                .set_value("ProxyEnable", &0_u32)
                .map_err(|error| format!("关闭 Windows 系统代理失败：{error}"))?;
        }

        notify_settings_changed();
        Ok(())
    }

    fn internet_settings() -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(
                INTERNET_SETTINGS_KEY,
                winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
            )
            .map_err(|error| format!("打开 Windows 系统代理设置失败：{error}"))
    }

    fn enable_proxy(settings: &RegKey, mixed_port: u16) -> Result<(), String> {
        settings
            .set_value("ProxyServer", &proxy_server(mixed_port))
            .map_err(|error| format!("写入 Windows 代理地址失败：{error}"))?;
        settings
            .set_value(
                "ProxyOverride",
                &"<local>;localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*",
            )
            .map_err(|error| format!("写入 Windows 代理绕过列表失败：{error}"))?;
        settings
            .set_value("ProxyEnable", &1_u32)
            .map_err(|error| format!("开启 Windows 系统代理失败：{error}"))?;
        settings
            .set_value("AutoConfigURL", &"")
            .map_err(|error| format!("停用 Windows PAC 代理失败：{error}"))?;
        settings
            .set_value("AutoDetect", &0_u32)
            .map_err(|error| format!("停用 Windows 自动代理检测失败：{error}"))
    }

    fn verify_enabled(settings: &RegKey, mixed_port: u16) -> Result<(), String> {
        let enabled = settings.get_value::<u32, _>("ProxyEnable").unwrap_or(0) == 1;
        let server = settings
            .get_value::<String, _>("ProxyServer")
            .unwrap_or_default();
        if enabled && server == proxy_server(mixed_port) {
            Ok(())
        } else {
            Err("Windows 未接受系统代理设置，已取消本次切换".into())
        }
    }

    fn proxy_server(mixed_port: u16) -> String {
        format!("127.0.0.1:{mixed_port}")
    }

    fn capture_backup(settings: &RegKey) -> ProxyBackup {
        ProxyBackup {
            proxy_enable: optional_value(settings, "ProxyEnable"),
            proxy_server: optional_value(settings, "ProxyServer"),
            proxy_override: optional_value(settings, "ProxyOverride"),
            auto_config_url: optional_value(settings, "AutoConfigURL"),
            auto_detect: optional_value(settings, "AutoDetect"),
        }
    }

    fn optional_value<T: winreg::types::FromRegValue>(settings: &RegKey, name: &str) -> Option<T> {
        settings.get_value(name).ok()
    }

    fn save_backup(path: &PathBuf, backup: &ProxyBackup) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建系统代理备份目录失败：{error}"))?;
        }
        let content = serde_json::to_vec_pretty(backup)
            .map_err(|error| format!("序列化系统代理备份失败：{error}"))?;
        fs::write(path, content).map_err(|error| format!("保存系统代理备份失败：{error}"))
    }

    fn restore_from_path(settings: &RegKey, path: &PathBuf) -> Result<(), String> {
        let content = fs::read(path).map_err(|error| format!("读取系统代理备份失败：{error}"))?;
        let backup = serde_json::from_slice::<ProxyBackup>(&content)
            .map_err(|error| format!("解析系统代理备份失败：{error}"))?;
        restore_value(settings, "ProxyEnable", backup.proxy_enable)?;
        restore_value(settings, "ProxyServer", backup.proxy_server)?;
        restore_value(settings, "ProxyOverride", backup.proxy_override)?;
        restore_value(settings, "AutoConfigURL", backup.auto_config_url)?;
        restore_value(settings, "AutoDetect", backup.auto_detect)
    }

    fn restore_value<T: winreg::types::ToRegValue>(
        settings: &RegKey,
        name: &str,
        value: Option<T>,
    ) -> Result<(), String> {
        match value {
            Some(value) => settings.set_value(name, &value),
            None => match settings.delete_value(name) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            },
        }
        .map_err(|error| format!("恢复 Windows 系统代理字段 {name} 失败：{error}"))
    }

    fn backup_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join(BACKUP_FILE_NAME))
    }

    fn notify_settings_changed() {
        unsafe {
            let _ = InternetSetOptionW(
                ptr::null_mut(),
                INTERNET_OPTION_SETTINGS_CHANGED,
                ptr::null_mut(),
                0,
            );
            let _ =
                InternetSetOptionW(ptr::null_mut(), INTERNET_OPTION_REFRESH, ptr::null_mut(), 0);
        }
    }

    fn with_rollback(error: String, rollback: Result<(), String>) -> String {
        match rollback {
            Ok(()) => format!("{error}；已恢复原系统代理设置"),
            Err(rollback_error) => format!("{error}；恢复原系统代理设置失败：{rollback_error}"),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_loopback_proxy_address() {
            assert_eq!(proxy_server(7890), "127.0.0.1:7890");
        }
    }
}

#[cfg(windows)]
pub use windows::apply;

#[cfg(not(windows))]
pub fn apply(_: &tauri::AppHandle, enabled: bool, _: u16) -> Result<(), String> {
    if enabled {
        Err("当前平台暂不支持系统代理切换".into())
    } else {
        Ok(())
    }
}
