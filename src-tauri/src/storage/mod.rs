use std::sync::Mutex;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::{
    config::{self, AppSettings, AppSettingsPatch, ProfileImportInput, ProfileSummary},
    core::{CoreManager, CoreStatus},
    proxy::{self, ProxyGroup},
};

pub struct AppState {
    core: CoreManager,
    profiles: Mutex<Vec<ProfileSummary>>,
    proxy_groups: Mutex<Vec<ProxyGroup>>,
    settings: Mutex<AppSettings>,
}

impl AppState {
    pub fn new(core: CoreManager) -> Self {
        Self {
            core,
            profiles: Mutex::new(config::seed_profiles()),
            proxy_groups: Mutex::new(proxy::sample_proxy_groups()),
            settings: Mutex::new(AppSettings::default()),
        }
    }

    pub fn core_status(&self) -> CoreStatus {
        self.core.status()
    }

    pub fn start_core(&self, app: &AppHandle) -> Result<CoreStatus, String> {
        self.core.start(app)
    }

    pub fn stop_core(&self) -> Result<CoreStatus, String> {
        self.core.stop()
    }

    pub fn list_profiles(&self) -> Result<Vec<ProfileSummary>, String> {
        self.profiles
            .lock()
            .map(|profiles| profiles.clone())
            .map_err(|error| error.to_string())
    }

    pub fn active_profile(&self) -> Result<Option<ProfileSummary>, String> {
        self.profiles
            .lock()
            .map(|profiles| profiles.iter().find(|profile| profile.active).cloned())
            .map_err(|error| error.to_string())
    }

    pub fn activate_profile(&self, id: &str) -> Result<ProfileSummary, String> {
        let mut profiles = self.profiles.lock().map_err(|error| error.to_string())?;
        let mut active = None;
        for profile in profiles.iter_mut() {
            profile.active = profile.id == id;
            if profile.active {
                active = Some(profile.clone());
            }
        }
        active.ok_or_else(|| format!("配置不存在: {id}"))
    }

    pub fn import_profile(&self, input: ProfileImportInput) -> Result<ProfileSummary, String> {
        if input.source == "remote" && input.url.as_deref().unwrap_or_default().is_empty() {
            return Err("远程配置需要订阅 URL".to_string());
        }
        if input.source == "local" && input.path.as_deref().unwrap_or_default().is_empty() {
            return Err("本地配置需要 YAML 路径".to_string());
        }

        let mut profiles = self.profiles.lock().map_err(|error| error.to_string())?;
        let profile = ProfileSummary {
            id: format!("profile-{}", profiles.len() + 1),
            name: input.name,
            source: input.source,
            updated_at: "刚刚".to_string(),
            rule_count: 0,
            active: false,
        };
        profiles.push(profile.clone());
        Ok(profile)
    }

    pub fn proxy_groups(&self) -> Vec<ProxyGroup> {
        self.proxy_groups
            .lock()
            .map(|groups| groups.clone())
            .unwrap_or_default()
    }

    pub fn select_proxy(&self, group: &str, proxy: &str) -> Result<ProxyGroup, String> {
        let mut groups = self.proxy_groups.lock().map_err(|error| error.to_string())?;
        let target_group = groups
            .iter_mut()
            .find(|item| item.name == group)
            .ok_or_else(|| format!("代理组不存在: {group}"))?;

        if !target_group.proxies.iter().any(|node| node.name == proxy) {
            return Err(format!("节点不存在: {proxy}"));
        }

        target_group.selected = proxy.to_string();
        Ok(target_group.clone())
    }

    pub fn settings(&self) -> Result<AppSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|error| error.to_string())
    }

    pub fn update_settings(&self, patch: AppSettingsPatch) -> Result<AppSettings, String> {
        let mut settings = self.settings.lock().map_err(|error| error.to_string())?;
        settings.apply_patch(patch);
        Ok(settings.clone())
    }
}

pub fn ensure_app_dirs(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = app.path().resolve("", BaseDirectory::AppConfig)?;
    std::fs::create_dir_all(config_dir.join("profiles"))?;
    std::fs::create_dir_all(config_dir.join("runtime"))?;
    Ok(())
}
