use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::platform;

#[derive(Clone, serde::Serialize)]
pub struct CoreStatus {
    pub running: bool,
    pub version: String,
    pub pid: Option<u32>,
    pub mode: String,
    pub mixed_port: u16,
    pub controller_url: String,
}

pub struct CoreManager {
    child: Mutex<Option<Child>>,
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

impl CoreManager {
    pub fn status(&self) -> CoreStatus {
        let child = self.child.lock().expect("core mutex poisoned");
        CoreStatus {
            running: child.is_some(),
            version: "mihomo-compatible".to_string(),
            pid: child.as_ref().map(std::process::Child::id),
            mode: "Rule".to_string(),
            mixed_port: 7890,
            controller_url: "http://127.0.0.1:9090".to_string(),
        }
    }

    pub fn start(&self, app: &AppHandle) -> Result<CoreStatus, String> {
        let mut child = self.child.lock().map_err(|error| error.to_string())?;
        if child.is_some() {
            return Ok(self.status());
        }

        let core_path = resolve_core_path(app)?;
        let runtime_config = crate::config::runtime_config_path(app).map_err(|error| error.to_string())?;
        crate::config::write_default_runtime_config(&runtime_config).map_err(|error| error.to_string())?;

        let spawned = Command::new(core_path)
            .arg("-f")
            .arg(runtime_config)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("无法启动 mihomo core: {error}"))?;

        *child = Some(spawned);
        drop(child);
        Ok(self.status())
    }

    pub fn stop(&self) -> Result<CoreStatus, String> {
        let mut child = self.child.lock().map_err(|error| error.to_string())?;
        if let Some(mut process) = child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
        drop(child);
        Ok(self.status())
    }
}

fn resolve_core_path(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = platform::core_binary_name();
    let relative = format!("core/{}/{}", platform::resource_platform_dir(), executable);
    let path = app
        .path()
        .resolve(relative, BaseDirectory::Resource)
        .map_err(|error| format!("无法解析 core 资源目录: {error}"))?;

    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "缺少 mihomo core 文件: {}。请把对应平台二进制放入 src-tauri/resources/core/{}/{}",
            path.display(),
            platform::resource_platform_dir(),
            executable
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::CoreManager;

    #[test]
    fn default_status_is_not_running() {
        let manager = CoreManager::default();
        let status = manager.status();
        assert!(!status.running);
        assert_eq!(status.mixed_port, 7890);
    }
}
