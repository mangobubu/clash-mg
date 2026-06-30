use tauri::AppHandle;

const AUTOSTART_NAME: &str = "Clash-MG";

pub fn apply(app: &AppHandle, enabled: bool) -> Result<(), String> {
    apply_platform(app, enabled)
}

#[cfg(windows)]
fn apply_platform(_app: &AppHandle, enabled: bool) -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|error| format!("打开 Windows 启动项失败：{error}"))?;
    if enabled {
        let executable =
            std::env::current_exe().map_err(|error| format!("读取应用路径失败：{error}"))?;
        run.set_value(
            AUTOSTART_NAME,
            &format!("\"{}\" --autostart", executable.display()),
        )
        .map_err(|error| format!("注册开机启动失败：{error}"))
    } else {
        match run.delete_value(AUTOSTART_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除开机启动项失败：{error}")),
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_platform(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use std::fs;
    use tauri::Manager;

    let directory = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".config/autostart");
    let path = directory.join("clash-mg.desktop");
    if !enabled {
        return remove_if_present(&path);
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    fs::write(
        path,
        format!(
            "[Desktop Entry]\nType=Application\nName=Clash-MG\nExec=\"{}\" --autostart\nX-GNOME-Autostart-enabled=true\n",
            executable.display()
        ),
    )
    .map_err(|error| format!("注册开机启动失败：{error}"))
}

#[cfg(target_os = "macos")]
fn apply_platform(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use std::fs;
    use tauri::Manager;

    let directory = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join("Library/LaunchAgents");
    let path = directory.join("com.clashmg.desktop.plist");
    if !enabled {
        return remove_if_present(&path);
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable
        .display()
        .to_string()
        .replace('&', "&amp;")
        .replace('<', "&lt;");
    fs::write(
        path,
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>com.clashmg.desktop</string><key>ProgramArguments</key><array><string>{executable}</string><string>--autostart</string></array><key>RunAtLoad</key><true/></dict></plist>"
        ),
    )
    .map_err(|error| format!("注册开机启动失败：{error}"))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn remove_if_present(path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除开机启动项失败：{error}")),
    }
}
