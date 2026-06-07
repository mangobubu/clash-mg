use std::{fs, path::PathBuf};

use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub source: String,
    pub updated_at: String,
    pub rule_count: u32,
    pub active: bool,
}

#[derive(Clone, serde::Deserialize)]
pub struct ProfileImportInput {
    pub name: String,
    pub source: String,
    pub path: Option<String>,
    pub url: Option<String>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub auto_start: bool,
    pub silent_start: bool,
    pub system_proxy: bool,
    pub tun_mode: bool,
    pub mixed_port: u16,
    pub log_level: String,
}

#[derive(Clone, Default, serde::Deserialize)]
pub struct AppSettingsPatch {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub auto_start: Option<bool>,
    pub silent_start: Option<bool>,
    pub system_proxy: Option<bool>,
    pub tun_mode: Option<bool>,
    pub mixed_port: Option<u16>,
    pub log_level: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            language: "zh-CN".to_string(),
            auto_start: false,
            silent_start: false,
            system_proxy: true,
            tun_mode: false,
            mixed_port: 7890,
            log_level: "info".to_string(),
        }
    }
}

impl AppSettings {
    pub fn apply_patch(&mut self, patch: AppSettingsPatch) {
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }
        if let Some(language) = patch.language {
            self.language = language;
        }
        if let Some(auto_start) = patch.auto_start {
            self.auto_start = auto_start;
        }
        if let Some(silent_start) = patch.silent_start {
            self.silent_start = silent_start;
        }
        if let Some(system_proxy) = patch.system_proxy {
            self.system_proxy = system_proxy;
        }
        if let Some(tun_mode) = patch.tun_mode {
            self.tun_mode = tun_mode;
        }
        if let Some(mixed_port) = patch.mixed_port {
            self.mixed_port = mixed_port;
        }
        if let Some(log_level) = patch.log_level {
            self.log_level = log_level;
        }
    }
}

pub fn seed_profiles() -> Vec<ProfileSummary> {
    vec![
        ProfileSummary {
            id: "main".to_string(),
            name: "主用订阅".to_string(),
            source: "remote".to_string(),
            updated_at: "刚刚".to_string(),
            rule_count: 4288,
            active: true,
        },
        ProfileSummary {
            id: "backup".to_string(),
            name: "备用机场".to_string(),
            source: "remote".to_string(),
            updated_at: "2 小时前".to_string(),
            rule_count: 3016,
            active: false,
        },
        ProfileSummary {
            id: "local-dev".to_string(),
            name: "本地调试".to_string(),
            source: "local".to_string(),
            updated_at: "昨天".to_string(),
            rule_count: 186,
            active: false,
        },
    ]
}

pub fn runtime_config_path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    let dir = app.path().resolve("runtime", BaseDirectory::AppConfig)?;
    Ok(dir.join("config.yaml"))
}

pub fn write_default_runtime_config(path: &PathBuf) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if !path.exists() {
        fs::write(
            path,
            "mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: info\nexternal-controller: 127.0.0.1:9090\nsecret: clash-mg-dev\n",
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, AppSettingsPatch};

    #[test]
    fn settings_patch_updates_only_present_fields() {
        let mut settings = AppSettings::default();
        settings.apply_patch(AppSettingsPatch {
            theme: Some("dark".to_string()),
            silent_start: Some(true),
            mixed_port: Some(8899),
            ..AppSettingsPatch::default()
        });

        assert_eq!(settings.theme, "dark");
        assert!(settings.silent_start);
        assert_eq!(settings.mixed_port, 8899);
        assert_eq!(settings.language, "zh-CN");
    }
}
