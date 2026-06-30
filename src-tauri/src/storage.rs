use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use tauri::{AppHandle, Manager};

use crate::{
    defaults::{default_snapshot, merge_default_settings},
    models::AppSnapshot,
};

const DATA_FILE_NAME: &str = "app-state.json";
const BACKUP_FILE_NAME: &str = "app-state.json.bak";
const TEMP_FILE_NAME: &str = "app-state.json.tmp";

static STORAGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn storage_lock() -> &'static Mutex<()> {
    STORAGE_LOCK.get_or_init(|| Mutex::new(()))
}

fn data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join(DATA_FILE_NAME))
}

fn backup_file_path(path: &Path) -> PathBuf {
    path.with_file_name(BACKUP_FILE_NAME)
}

fn temp_file_path(path: &Path) -> PathBuf {
    path.with_file_name(TEMP_FILE_NAME)
}

pub fn load_snapshot(app: &AppHandle) -> Result<AppSnapshot, String> {
    let path = data_file_path(app)?;
    let _guard = storage_lock()
        .lock()
        .map_err(|_| "应用状态存储锁不可用".to_string())?;
    load_snapshot_from_path(&path)
}

fn load_snapshot_from_path(path: &Path) -> Result<AppSnapshot, String> {
    let backup_path = backup_file_path(path);
    let primary_result = path.is_file().then(|| read_snapshot(path));
    if let Some(Ok(snapshot)) = primary_result.as_ref() {
        return Ok(snapshot.clone());
    }

    let backup_result = backup_path.is_file().then(|| read_snapshot(&backup_path));
    if let Some(Ok(snapshot)) = backup_result.as_ref() {
        return Ok(snapshot.clone());
    }

    match (primary_result, backup_result) {
        (None, None) => Ok(default_snapshot()),
        (Some(Err(primary)), None) => Err(format!("读取应用状态失败：{primary}；不存在可用备份")),
        (None, Some(Err(backup))) => Err(format!("主状态文件不存在，且备份读取失败：{backup}")),
        (Some(Err(primary)), Some(Err(backup))) => Err(format!(
            "主状态文件和备份均不可用：主文件：{primary}；备份：{backup}"
        )),
        _ => unreachable!("有效快照已提前返回"),
    }
}

fn read_snapshot(path: &Path) -> Result<AppSnapshot, String> {
    let content =
        fs::read_to_string(path).map_err(|error| format!("{}：{error}", path.display()))?;
    let mut snapshot = serde_json::from_str::<AppSnapshot>(&content)
        .map_err(|error| format!("{}：{error}", path.display()))?;
    merge_default_settings(&mut snapshot.settings);
    snapshot
        .subscriptions
        .retain(|subscription| !subscription.is_runtime_provider_record());
    Ok(snapshot)
}

pub fn save_snapshot(app: &AppHandle, snapshot: &AppSnapshot) -> Result<(), String> {
    let path = data_file_path(app)?;
    let _guard = storage_lock()
        .lock()
        .map_err(|_| "应用状态存储锁不可用".to_string())?;
    save_snapshot_to_path(&path, snapshot)
}

fn save_snapshot_to_path(path: &Path, snapshot: &AppSnapshot) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_vec_pretty(snapshot).map_err(|error| error.to_string())?;
    let temp_path = temp_file_path(path);
    let backup_path = backup_file_path(path);
    if temp_path.exists() {
        fs::remove_file(&temp_path).map_err(|error| format!("清理状态临时文件失败：{error}"))?;
    }

    write_synced_file(&temp_path, &content)?;

    if path.is_file() {
        if read_snapshot(path).is_ok() {
            if backup_path.exists() {
                fs::remove_file(&backup_path)
                    .map_err(|error| format!("更新状态备份失败：{error}"))?;
            }
            fs::rename(path, &backup_path)
                .map_err(|error| format!("备份当前应用状态失败：{error}"))?;
        } else {
            fs::remove_file(path).map_err(|error| format!("移除损坏状态文件失败：{error}"))?;
        }
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        if !path.exists() && backup_path.is_file() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(format!("原子替换应用状态失败：{error}"));
    }
    Ok(())
}

fn write_synced_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = File::create(path).map_err(|error| format!("创建状态临时文件失败：{error}"))?;
    file.write_all(content)
        .map_err(|error| format!("写入状态临时文件失败：{error}"))?;
    file.sync_all()
        .map_err(|error| format!("同步状态临时文件失败：{error}"))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn test_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应有效")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("clash-mg-storage-{}-{nonce}", std::process::id()))
            .join(name)
    }

    fn snapshot(accent: &str) -> AppSnapshot {
        let mut snapshot = default_snapshot();
        snapshot.accent = accent.into();
        snapshot
    }

    #[test]
    fn saves_with_backup_and_recovers_from_corrupted_primary() {
        let path = test_path(DATA_FILE_NAME);
        save_snapshot_to_path(&path, &snapshot("first")).expect("首次保存应成功");
        save_snapshot_to_path(&path, &snapshot("second")).expect("再次保存应成功");

        assert_eq!(read_snapshot(&path).expect("主文件应有效").accent, "second");
        assert_eq!(
            read_snapshot(&backup_file_path(&path))
                .expect("备份应有效")
                .accent,
            "first"
        );

        fs::write(&path, b"{broken").expect("应能构造损坏主文件");
        let recovered = load_snapshot_from_path(&path).expect("应从备份恢复");
        assert_eq!(recovered.accent, "first");
        assert!(!temp_file_path(&path).exists());

        let _ = fs::remove_dir_all(path.parent().expect("测试路径应有父目录"));
    }

    #[test]
    fn uses_backup_when_primary_is_missing() {
        let path = test_path(DATA_FILE_NAME);
        let backup = backup_file_path(&path);
        fs::create_dir_all(path.parent().expect("测试路径应有父目录")).expect("应创建测试目录");
        let content = serde_json::to_vec_pretty(&snapshot("backup")).expect("应序列化快照");
        write_synced_file(&backup, &content).expect("应写入备份");

        assert_eq!(
            load_snapshot_from_path(&path).expect("应读取备份").accent,
            "backup"
        );

        let _ = fs::remove_dir_all(path.parent().expect("测试路径应有父目录"));
    }

    #[test]
    fn rejects_corrupted_primary_and_backup() {
        let path = test_path(DATA_FILE_NAME);
        fs::create_dir_all(path.parent().expect("测试路径应有父目录")).expect("应创建测试目录");
        fs::write(&path, b"bad primary").expect("应写入损坏主文件");
        fs::write(backup_file_path(&path), b"bad backup").expect("应写入损坏备份");

        let error = load_snapshot_from_path(&path).expect_err("主备损坏时必须报错");
        assert!(error.contains("主状态文件和备份均不可用"));

        let _ = fs::remove_dir_all(path.parent().expect("测试路径应有父目录"));
    }
}
