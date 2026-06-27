use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::{engine::general_purpose, Engine as _};
use chrono::{Local, TimeZone};
use reqwest::{
    header::{HeaderMap, USER_AGENT},
    Client,
};
use serde_yaml::{Mapping, Value};
use tauri::AppHandle;

use crate::{
    core,
    defaults::current_time,
    mihomo::{self, MihomoClient},
    models::{AppSnapshot, LocalSubscriptionRefreshResult, Subscription},
};

const MAX_SUBSCRIPTION_BYTES: usize = 16 * 1024 * 1024;
const SUBSCRIPTION_USER_AGENT: &str = "mihomo/1.19 clash-mg/0.1";
const SUBSCRIPTION_DIR_NAME: &str = "subscriptions";
const ACTIVE_CONFIG_NAME: &str = "config.yaml";
const CANDIDATE_CONFIG_NAME: &str = "config.candidate.yaml";
const SHARE_LINK_SCHEMES: [&str; 9] = [
    "ss://",
    "ssr://",
    "vmess://",
    "vless://",
    "trojan://",
    "hysteria://",
    "hysteria2://",
    "hy2://",
    "tuic://",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct DownloadedSubscription {
    id: String,
    content: String,
    node_count: usize,
    used_traffic: Option<String>,
    expires_at: Option<String>,
}

#[derive(Debug)]
enum ParsedSubscription {
    ClashConfig {
        proxies: Vec<Value>,
        groups: Vec<Value>,
        providers: Mapping,
    },
    ProviderContent,
}

struct FileBackup {
    path: PathBuf,
    content: Option<Vec<u8>>,
}

impl FileBackup {
    fn capture(path: PathBuf) -> Result<Self, String> {
        let content = if path.exists() {
            Some(fs::read(&path).map_err(|error| error.to_string())?)
        } else {
            None
        };
        Ok(Self { path, content })
    }

    fn restore(&self) -> Result<(), String> {
        match &self.content {
            Some(content) => replace_file(&self.path, content),
            None if self.path.exists() => {
                fs::remove_file(&self.path).map_err(|error| error.to_string())
            }
            None => Ok(()),
        }
    }
}

pub async fn refresh_local_subscriptions(
    app: &AppHandle,
    mut snapshot: AppSnapshot,
    subscription_ids: Vec<String>,
) -> LocalSubscriptionRefreshResult {
    let mut result = LocalSubscriptionRefreshResult {
        snapshot: snapshot.clone(),
        updated: 0,
        failed: 0,
        skipped: 0,
        messages: Vec::new(),
    };
    let refresh_all = subscription_ids.is_empty();
    let targets = snapshot
        .subscriptions
        .iter()
        .filter(|subscription| {
            (refresh_all || subscription_ids.iter().any(|id| id == &subscription.id))
                && !is_runtime_provider(subscription)
        })
        .cloned()
        .collect::<Vec<_>>();

    if targets.is_empty() {
        result.skipped = subscription_ids.len();
        result.messages.push("没有找到可刷新的本地订阅".into());
        return result;
    }

    let client = match Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(error) => {
            result.failed = targets.len();
            result
                .messages
                .push(format!("订阅下载客户端初始化失败：{error}"));
            return result;
        }
    };

    let mut downloaded = Vec::new();
    for subscription in &targets {
        match download_subscription(&client, subscription).await {
            Ok(value) => downloaded.push(value),
            Err(error) => {
                mark_subscription_failed(&mut snapshot, &subscription.id);
                result.failed += 1;
                result
                    .messages
                    .push(format!("订阅“{}”更新失败：{error}", subscription.name));
            }
        }
    }

    if downloaded.is_empty() {
        result.snapshot = snapshot;
        return result;
    }

    match apply_downloads(app, &snapshot, &downloaded).await {
        Ok(refreshed_snapshot) => {
            snapshot = refreshed_snapshot;
            for value in &downloaded {
                if let Some(subscription) = snapshot
                    .subscriptions
                    .iter_mut()
                    .find(|subscription| subscription.id == value.id)
                {
                    subscription.node_count = value.node_count;
                    subscription.last_updated = current_time();
                    subscription.status = if subscription.enabled {
                        "正常".into()
                    } else {
                        "已禁用".into()
                    };
                    if let Some(used_traffic) = &value.used_traffic {
                        subscription.used_traffic = used_traffic.clone();
                    }
                    if let Some(expires_at) = &value.expires_at {
                        subscription.expires_at = expires_at.clone();
                    }
                }
            }
            result.updated = downloaded.len();
            mihomo::push_runtime_log(
                &mut snapshot,
                "SUCCESS",
                "订阅",
                &format!(
                    "已保存、校验并应用 {count} 个本地订阅，运行时节点已刷新",
                    count = result.updated
                ),
            );
        }
        Err(error) => {
            for value in &downloaded {
                mark_subscription_failed(&mut snapshot, &value.id);
            }
            result.failed += downloaded.len();
            result.messages.push(error.clone());
            mihomo::push_runtime_log(&mut snapshot, "ERROR", "订阅", &error);
        }
    }

    result.snapshot = snapshot;
    result
}

async fn apply_downloads(
    app: &AppHandle,
    snapshot: &AppSnapshot,
    downloaded: &[DownloadedSubscription],
) -> Result<AppSnapshot, String> {
    let core_dir = core::core_dir(app)?;
    let subscription_dir = core_dir.join(SUBSCRIPTION_DIR_NAME);
    fs::create_dir_all(&subscription_dir).map_err(|error| error.to_string())?;

    let mut backups = Vec::new();
    for value in downloaded {
        let path = subscription_cache_path(&subscription_dir, &value.id);
        backups.push(FileBackup::capture(path.clone())?);
        if let Err(error) = replace_file(&path, value.content.as_bytes()) {
            return Err(with_rollback_result(
                format!("保存订阅缓存失败：{error}"),
                restore_files(&backups),
            ));
        }
    }

    let candidate_content = match build_effective_config(app, snapshot) {
        Ok(content) => content,
        Err(error) => {
            return Err(with_rollback_result(
                format!("生成合并配置失败：{error}"),
                restore_files(&backups),
            ));
        }
    };
    let candidate_path = core_dir.join(CANDIDATE_CONFIG_NAME);
    if let Err(error) = replace_file(&candidate_path, candidate_content.as_bytes()) {
        return Err(with_rollback_result(
            format!("写入候选配置失败：{error}"),
            restore_files(&backups),
        ));
    }

    if let Err(error) = validate_config(app, &candidate_path) {
        let rollback = restore_files(&backups);
        let _ = fs::remove_file(&candidate_path);
        return Err(with_rollback_result(
            format!("Mihomo 配置校验失败：{error}"),
            rollback,
        ));
    }

    let controller = match MihomoClient::from_settings(&snapshot.settings) {
        Some(controller) => controller,
        None => {
            let rollback = restore_files(&backups);
            let _ = fs::remove_file(&candidate_path);
            return Err(with_rollback_result(
                "未配置 Mihomo 外部控制器地址".into(),
                rollback,
            ));
        }
    };

    let active_path = core_dir.join(ACTIVE_CONFIG_NAME);
    let mut active_backup = match FileBackup::capture(active_path.clone()) {
        Ok(backup) => backup,
        Err(error) => {
            let rollback = restore_files(&backups);
            let _ = fs::remove_file(&candidate_path);
            return Err(with_rollback_result(
                format!("备份当前有效配置失败：{error}"),
                rollback,
            ));
        }
    };
    if active_backup.content.is_none() {
        match load_base_config(snapshot) {
            Ok(base_content) => active_backup.content = Some(base_content.into_bytes()),
            Err(error) => {
                let rollback = restore_files(&backups);
                let _ = fs::remove_file(&candidate_path);
                return Err(with_rollback_result(
                    format!("准备配置回滚副本失败：{error}"),
                    rollback,
                ));
            }
        }
    }
    if let Err(error) = replace_file(&active_path, candidate_content.as_bytes()) {
        let rollback = restore_active_and_subscriptions(&active_backup, &backups);
        let _ = fs::remove_file(&candidate_path);
        return Err(with_rollback_result(
            format!("替换有效配置失败：{error}"),
            rollback,
        ));
    }
    let _ = fs::remove_file(&candidate_path);

    if let Err(error) = controller.reload_config(&candidate_content).await {
        let rollback = rollback_applied_files(&controller, &active_backup, &backups).await;
        return Err(reload_error_with_rollback(
            format!("通知 Mihomo 热重载失败：{error}"),
            rollback,
        ));
    }

    if let Err(error) = controller.verify_runtime_proxies().await {
        let rollback = rollback_applied_files(&controller, &active_backup, &backups).await;
        return Err(reload_error_with_rollback(
            format!("Mihomo 重载后无法读取代理节点：{error}"),
            rollback,
        ));
    }

    Ok(mihomo::refresh_runtime_data(snapshot.clone()).await)
}

async fn rollback_applied_files(
    controller: &MihomoClient,
    active_backup: &FileBackup,
    subscription_backups: &[FileBackup],
) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(error) = restore_active_and_subscriptions(active_backup, subscription_backups) {
        errors.push(error);
    }
    if let Some(old_config) = active_backup
        .content
        .as_ref()
        .and_then(|content| String::from_utf8(content.clone()).ok())
    {
        if let Err(error) = controller.reload_config(&old_config).await {
            errors.push(format!("重新加载旧配置失败：{error}"));
        }
    } else {
        errors.push("旧配置不是有效 UTF-8 文本".into());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

pub(crate) fn build_effective_config(
    app: &AppHandle,
    snapshot: &AppSnapshot,
) -> Result<String, String> {
    let base_content = load_base_config(snapshot)?;
    let mut root = serde_yaml::from_str::<Value>(&base_content)
        .map_err(|error| format!("基础配置不是有效 YAML：{error}"))?;
    let root_mapping = root
        .as_mapping_mut()
        .ok_or_else(|| "基础配置根节点必须是 YAML 对象".to_string())?;

    let mut proxies = take_sequence(root_mapping, "proxies")?;
    let mut groups = take_sequence(root_mapping, "proxy-groups")?;
    let mut providers = take_mapping(root_mapping, "proxy-providers")?;
    let subscription_dir = core::core_dir(app)?.join(SUBSCRIPTION_DIR_NAME);

    for subscription in snapshot.subscriptions.iter().filter(|subscription| {
        subscription.enabled && subscription.proxy_update && !is_runtime_provider(subscription)
    }) {
        let cache_path = subscription_cache_path(&subscription_dir, &subscription.id);
        if !cache_path.is_file() {
            continue;
        }
        let content = fs::read_to_string(&cache_path)
            .map_err(|error| format!("读取订阅“{}”缓存失败：{error}", subscription.name))?;

        merge_parsed_subscription(
            subscription,
            parse_subscription(&content)?,
            &mut proxies,
            &mut groups,
            &mut providers,
        )?;
    }

    root_mapping.insert(key("proxies"), Value::Sequence(proxies));
    root_mapping.insert(key("proxy-groups"), Value::Sequence(groups));
    if !providers.is_empty() {
        root_mapping.insert(key("proxy-providers"), Value::Mapping(providers));
    }

    serde_yaml::to_string(&root).map_err(|error| format!("序列化合并配置失败：{error}"))
}

fn merge_parsed_subscription(
    subscription: &Subscription,
    parsed: ParsedSubscription,
    proxies: &mut Vec<Value>,
    groups: &mut Vec<Value>,
    providers: &mut Mapping,
) -> Result<(), String> {
    match parsed {
        ParsedSubscription::ClashConfig {
            proxies: incoming_proxies,
            groups: incoming_groups,
            providers: incoming_providers,
        } => {
            let node_names = named_values(&incoming_proxies, "代理节点")?;
            let provider_names = incoming_providers
                .keys()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            merge_named_sequence(
                proxies,
                incoming_proxies,
                subscription.allow_override,
                "代理节点",
            )?;
            merge_mapping(
                providers,
                incoming_providers,
                subscription.allow_override,
                "代理 Provider",
            )?;
            if incoming_groups.is_empty() {
                if !node_names.is_empty() || !provider_names.is_empty() {
                    merge_named_sequence(
                        groups,
                        vec![generated_group(
                            &subscription.name,
                            &node_names,
                            &provider_names,
                        )],
                        subscription.allow_override,
                        "代理组",
                    )?;
                }
            } else {
                merge_named_sequence(
                    groups,
                    incoming_groups,
                    subscription.allow_override,
                    "代理组",
                )?;
            }
        }
        ParsedSubscription::ProviderContent => {
            let provider_name = provider_name(&subscription.id);
            let provider = file_provider(&subscription_cache_relative_path(&subscription.id));
            merge_mapping(
                providers,
                Mapping::from_iter([(Value::String(provider_name.clone()), provider)]),
                subscription.allow_override,
                "代理 Provider",
            )?;
            merge_named_sequence(
                groups,
                vec![generated_group(&subscription.name, &[], &[provider_name])],
                subscription.allow_override,
                "代理组",
            )?;
        }
    }
    Ok(())
}

fn load_base_config(snapshot: &AppSnapshot) -> Result<String, String> {
    let override_path = snapshot
        .settings
        .get("configOverride")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match override_path {
        Some(path) => fs::read_to_string(path)
            .map_err(|error| format!("读取自定义基础配置“{path}”失败：{error}")),
        None => Ok(core::generated_config_content(&snapshot.settings)),
    }
}

fn parse_subscription(content: &str) -> Result<ParsedSubscription, String> {
    if let Ok(Value::Mapping(mapping)) = serde_yaml::from_str::<Value>(content) {
        let proxies = mapping
            .get(key("proxies"))
            .and_then(Value::as_sequence)
            .cloned()
            .unwrap_or_default();
        let groups = mapping
            .get(key("proxy-groups"))
            .and_then(Value::as_sequence)
            .cloned()
            .unwrap_or_default();
        let providers = mapping
            .get(key("proxy-providers"))
            .and_then(Value::as_mapping)
            .cloned()
            .unwrap_or_default();
        if !proxies.is_empty() || !groups.is_empty() || !providers.is_empty() {
            return Ok(ParsedSubscription::ClashConfig {
                proxies,
                groups,
                providers,
            });
        }
    }

    if count_share_links(content) > 0 {
        return Ok(ParsedSubscription::ProviderContent);
    }
    if let Some(decoded) = decode_base64_subscription(content) {
        if count_share_links(&decoded) > 0 {
            return Ok(ParsedSubscription::ProviderContent);
        }
    }

    Err("订阅内容既不是 Clash/Mihomo YAML，也不是受支持的 URI/Base64 节点列表".into())
}

async fn download_subscription(
    client: &Client,
    subscription: &Subscription,
) -> Result<DownloadedSubscription, String> {
    let url = subscription.url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持 HTTP/HTTPS 订阅链接".into());
    }
    let response = client
        .get(url)
        .header(USER_AGENT, SUBSCRIPTION_USER_AGENT)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("订阅地址返回 HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SUBSCRIPTION_BYTES as u64)
    {
        return Err("订阅内容超过 16 MB，已停止下载".into());
    }

    let headers = response.headers().clone();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SUBSCRIPTION_BYTES {
        return Err("订阅内容超过 16 MB，已停止解析".into());
    }
    let content =
        String::from_utf8(bytes.to_vec()).map_err(|_| "订阅内容不是有效 UTF-8 文本".to_string())?;
    let parsed = parse_subscription(&content)?;
    let node_count = parsed_node_count(&parsed, &content);
    let (used_traffic, expires_at) = parse_subscription_userinfo(&headers);

    Ok(DownloadedSubscription {
        id: subscription.id.clone(),
        content,
        node_count,
        used_traffic,
        expires_at,
    })
}

fn parsed_node_count(parsed: &ParsedSubscription, content: &str) -> usize {
    match parsed {
        ParsedSubscription::ClashConfig { proxies, .. } => proxies.len(),
        ParsedSubscription::ProviderContent => {
            let direct = count_share_links(content);
            if direct > 0 {
                direct
            } else {
                decode_base64_subscription(content)
                    .map(|decoded| count_share_links(&decoded))
                    .unwrap_or(0)
            }
        }
    }
}

fn validate_config(app: &AppHandle, path: &Path) -> Result<(), String> {
    let executable = core::core_executable_path(app)?;
    if !executable.is_file() {
        return Err("Mihomo 内核不存在，无法执行配置校验".into());
    }
    let mut command = Command::new(executable);
    command
        .arg("-t")
        .arg("-f")
        .arg(path)
        .arg("-d")
        .arg(core::core_dir(app)?);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("执行 Mihomo 测试模式失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() { stderr } else { stdout })
}

fn merge_named_sequence(
    target: &mut Vec<Value>,
    incoming: Vec<Value>,
    allow_override: bool,
    kind: &str,
) -> Result<(), String> {
    let mut positions = HashMap::new();
    for (index, item) in target.iter().enumerate() {
        if let Some(name) = item_name(item) {
            positions.insert(name.to_string(), index);
        }
    }

    for item in incoming {
        let name = item_name(&item)
            .ok_or_else(|| format!("{kind}缺少 name 字段"))?
            .to_string();
        if let Some(index) = positions.get(&name).copied() {
            if !allow_override {
                return Err(format!(
                    "{kind}名称“{name}”冲突；请开启“允许覆写节点”后重试"
                ));
            }
            target[index] = item;
        } else {
            positions.insert(name, target.len());
            target.push(item);
        }
    }
    Ok(())
}

fn merge_mapping(
    target: &mut Mapping,
    incoming: Mapping,
    allow_override: bool,
    kind: &str,
) -> Result<(), String> {
    for (name, value) in incoming {
        if target.contains_key(&name) && !allow_override {
            return Err(format!(
                "{kind}名称“{}”冲突；请开启“允许覆写节点”后重试",
                name.as_str().unwrap_or("未知")
            ));
        }
        target.insert(name, value);
    }
    Ok(())
}

fn generated_group(name: &str, proxies: &[String], providers: &[String]) -> Value {
    let mut group = Mapping::new();
    group.insert(key("name"), Value::String(name.to_string()));
    group.insert(key("type"), Value::String("select".into()));
    if !proxies.is_empty() {
        group.insert(
            key("proxies"),
            Value::Sequence(proxies.iter().cloned().map(Value::String).collect()),
        );
    }
    if !providers.is_empty() {
        group.insert(
            key("use"),
            Value::Sequence(providers.iter().cloned().map(Value::String).collect()),
        );
    }
    Value::Mapping(group)
}

fn file_provider(relative_path: &str) -> Value {
    let mut provider = Mapping::new();
    provider.insert(key("type"), Value::String("file".into()));
    provider.insert(key("path"), Value::String(relative_path.to_string()));
    Value::Mapping(provider)
}

fn take_sequence(mapping: &mut Mapping, name: &str) -> Result<Vec<Value>, String> {
    match mapping.remove(key(name)) {
        Some(Value::Sequence(sequence)) => Ok(sequence),
        Some(_) => Err(format!("基础配置字段 {name} 必须是数组")),
        None => Ok(Vec::new()),
    }
}

fn take_mapping(mapping: &mut Mapping, name: &str) -> Result<Mapping, String> {
    match mapping.remove(key(name)) {
        Some(Value::Mapping(value)) => Ok(value),
        Some(_) => Err(format!("基础配置字段 {name} 必须是对象")),
        None => Ok(Mapping::new()),
    }
}

fn named_values(values: &[Value], kind: &str) -> Result<Vec<String>, String> {
    values
        .iter()
        .map(|value| {
            item_name(value)
                .map(ToString::to_string)
                .ok_or_else(|| format!("{kind}缺少 name 字段"))
        })
        .collect()
}

fn item_name(value: &Value) -> Option<&str> {
    value.as_mapping()?.get(key("name"))?.as_str()
}

fn key(value: &str) -> Value {
    Value::String(value.to_string())
}

fn subscription_cache_path(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{}.yaml", safe_identifier(id)))
}

fn subscription_cache_relative_path(id: &str) -> String {
    format!("./{SUBSCRIPTION_DIR_NAME}/{}.yaml", safe_identifier(id))
}

fn provider_name(id: &str) -> String {
    format!("local-subscription-{}", safe_identifier(id))
}

fn safe_identifier(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "subscription".into()
    } else {
        sanitized
    }
}

fn replace_file(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn restore_files(backups: &[FileBackup]) -> Result<(), String> {
    let mut errors = Vec::new();
    for backup in backups.iter().rev() {
        if let Err(error) = backup.restore() {
            errors.push(format!("{}：{error}", backup.path.to_string_lossy()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn restore_active_and_subscriptions(
    active_backup: &FileBackup,
    subscription_backups: &[FileBackup],
) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(error) = active_backup.restore() {
        errors.push(format!("恢复旧配置文件失败：{error}"));
    }
    if let Err(error) = restore_files(subscription_backups) {
        errors.push(format!("恢复订阅缓存失败：{error}"));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn with_rollback_result(message: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => message,
        Err(error) => format!("{message}；同时回滚订阅缓存失败：{error}"),
    }
}

fn reload_error_with_rollback(message: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => format!("{message}；已回滚旧配置"),
        Err(error) => format!("{message}；回滚失败：{error}"),
    }
}

fn mark_subscription_failed(snapshot: &mut AppSnapshot, id: &str) {
    if let Some(subscription) = snapshot
        .subscriptions
        .iter_mut()
        .find(|subscription| subscription.id == id)
    {
        subscription.last_updated = current_time();
        subscription.status = "更新失败".into();
    }
}

fn is_runtime_provider(subscription: &Subscription) -> bool {
    subscription.is_runtime_provider_record()
}

fn count_share_links(content: &str) -> usize {
    content
        .lines()
        .filter(|line| {
            let line = line.trim_start().to_lowercase();
            SHARE_LINK_SCHEMES
                .iter()
                .any(|scheme| line.starts_with(scheme))
        })
        .count()
}

fn decode_base64_subscription(content: &str) -> Option<String> {
    let compact = content
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if compact.is_empty() || compact.len() % 4 == 1 {
        return None;
    }
    let padded = match compact.len() % 4 {
        0 => compact.clone(),
        remainder => format!("{compact}{}", "=".repeat(4 - remainder)),
    };
    let decoded = general_purpose::STANDARD
        .decode(padded.as_bytes())
        .or_else(|_| general_purpose::URL_SAFE.decode(padded.as_bytes()))
        .or_else(|_| general_purpose::URL_SAFE_NO_PAD.decode(compact.as_bytes()))
        .ok()?;
    String::from_utf8(decoded).ok()
}

fn parse_subscription_userinfo(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let Some(raw) = headers
        .get("subscription-userinfo")
        .and_then(|value| value.to_str().ok())
    else {
        return (None, None);
    };
    let mut upload = 0_u64;
    let mut download = 0_u64;
    let mut total = 0_u64;
    let mut expire = 0_u64;
    for segment in raw.split(';') {
        let Some((name, value)) = segment.trim().split_once('=') else {
            continue;
        };
        let Ok(value) = value.trim().parse::<u64>() else {
            continue;
        };
        match name.trim().to_lowercase().as_str() {
            "upload" => upload = value,
            "download" => download = value,
            "total" => total = value,
            "expire" => expire = value,
            _ => {}
        }
    }
    let used = upload.saturating_add(download);
    let used_traffic = if total > 0 {
        Some(format!("{} / {}", format_bytes(used), format_bytes(total)))
    } else if used > 0 {
        Some(format_bytes(used))
    } else {
        None
    };
    let expires_at = if expire > 0 {
        Local
            .timestamp_opt(expire as i64, 0)
            .single()
            .map(|time| time.format("%Y-%m-%d").to_string())
    } else {
        None
    };
    (used_traffic, expires_at)
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named_item(name: &str) -> Value {
        let mut mapping = Mapping::new();
        mapping.insert(key("name"), Value::String(name.into()));
        Value::Mapping(mapping)
    }

    fn subscription(allow_override: bool) -> Subscription {
        Subscription {
            id: "subscription-id".into(),
            name: "测试订阅".into(),
            subscription_type: "HTTP".into(),
            url: "https://example.com/subscription".into(),
            node_count: 0,
            last_updated: "尚未更新".into(),
            update_interval: 12,
            status: "正常".into(),
            enabled: true,
            auto_update: true,
            proxy_update: true,
            allow_override,
            description: None,
            used_traffic: "0 B".into(),
            expires_at: "未知".into(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn parses_clash_yaml_and_uri_formats() {
        let yaml = "proxies:\n  - name: HK\n    type: ss\nproxy-groups:\n  - name: 自动选择\n    type: select\n    proxies: [HK]\n";
        assert!(matches!(
            parse_subscription(yaml),
            Ok(ParsedSubscription::ClashConfig { .. })
        ));
        assert!(matches!(
            parse_subscription("ss://example\nvmess://example"),
            Ok(ParsedSubscription::ProviderContent)
        ));
    }

    #[test]
    fn parses_base64_uri_subscription() {
        let encoded = general_purpose::STANDARD.encode("ss://example\nvmess://example");
        assert!(matches!(
            parse_subscription(&encoded),
            Ok(ParsedSubscription::ProviderContent)
        ));
    }

    #[test]
    fn rejects_name_conflict_without_override() {
        let mut target = vec![named_item("HK")];
        let error = merge_named_sequence(&mut target, vec![named_item("HK")], false, "代理节点")
            .expect_err("同名节点应被拒绝");
        assert!(error.contains("冲突"));
    }

    #[test]
    fn replaces_name_conflict_with_override() {
        let mut target = vec![named_item("HK")];
        merge_named_sequence(&mut target, vec![named_item("HK")], true, "代理节点")
            .expect("允许覆写时应替换同名节点");
        assert_eq!(target.len(), 1);
    }

    #[test]
    fn merges_clash_nodes_and_groups() {
        let parsed = parse_subscription(
            "proxies:\n  - name: HK\n    type: ss\nproxy-groups:\n  - name: 自动选择\n    type: select\n    proxies: [HK]\n",
        )
        .expect("应解析 Clash 配置");
        let mut proxies = Vec::new();
        let mut groups = Vec::new();
        let mut providers = Mapping::new();
        merge_parsed_subscription(
            &subscription(false),
            parsed,
            &mut proxies,
            &mut groups,
            &mut providers,
        )
        .expect("应合并节点与代理组");
        assert_eq!(
            named_values(&proxies, "代理节点").expect("应读取节点名"),
            ["HK"]
        );
        assert_eq!(
            named_values(&groups, "代理组").expect("应读取组名"),
            ["自动选择"]
        );
        assert!(providers.is_empty());
    }

    #[test]
    fn creates_file_provider_and_group_for_base64_subscription() {
        let mut proxies = Vec::new();
        let mut groups = Vec::new();
        let mut providers = Mapping::new();
        merge_parsed_subscription(
            &subscription(false),
            ParsedSubscription::ProviderContent,
            &mut proxies,
            &mut groups,
            &mut providers,
        )
        .expect("应生成 Provider 配置");
        assert!(proxies.is_empty());
        assert!(providers.contains_key(key("local-subscription-subscription-id")));
        assert_eq!(
            named_values(&groups, "代理组").expect("应读取组名"),
            ["测试订阅"]
        );
    }

    #[test]
    fn file_backup_restores_previous_content() {
        let directory =
            std::env::temp_dir().join(format!("clash-mg-subscription-test-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let path = directory.join("cache.yaml");
        fs::write(&path, "old").expect("应写入旧内容");
        let backup = FileBackup::capture(path.clone()).expect("应创建备份");
        replace_file(&path, b"new").expect("应替换内容");
        backup.restore().expect("应恢复备份");
        assert_eq!(fs::read_to_string(&path).expect("应读取内容"), "old");
        let _ = fs::remove_dir_all(directory);
    }
}
