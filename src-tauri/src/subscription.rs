use std::{
    collections::{HashMap, HashSet},
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
    models::{AppSnapshot, LocalSubscriptionRefreshResult, ProxyNode, SettingsMap, Subscription},
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
        rules: Vec<Value>,
        rule_providers: Mapping,
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

pub async fn delete_local_subscription(
    app: &AppHandle,
    mut snapshot: AppSnapshot,
    subscription_id: &str,
) -> Result<AppSnapshot, String> {
    let Some(index) = snapshot
        .subscriptions
        .iter()
        .position(|subscription| subscription.id == subscription_id)
    else {
        return Err("要删除的订阅不存在".into());
    };
    let removed_subscription = snapshot.subscriptions.remove(index);
    let core_dir = core::core_dir(app)?;
    let subscription_dir = core_dir.join(SUBSCRIPTION_DIR_NAME);
    let cache_path = subscription_cache_path(&subscription_dir, subscription_id);
    let cache_backup = FileBackup::capture(cache_path.clone())?;
    let cached_content = cache_backup
        .content
        .as_ref()
        .and_then(|content| String::from_utf8(content.clone()).ok());

    if cache_backup.content.is_none() {
        prune_removed_subscription_data(&mut snapshot, &removed_subscription, None);
        return Ok(snapshot);
    }

    let candidate_content = build_effective_config(app, &snapshot)
        .map_err(|error| format!("删除订阅后生成配置失败：{error}"))?;
    let controller = if snapshot.runtime.controller_connected {
        Some(
            MihomoClient::from_settings(&snapshot.settings)
                .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?,
        )
    } else {
        None
    };
    let candidate_path = core_dir.join(CANDIDATE_CONFIG_NAME);
    replace_file(&candidate_path, candidate_content.as_bytes())
        .map_err(|error| format!("写入删除订阅后的候选配置失败：{error}"))?;

    let executable = core::core_executable_path(app)?;
    if executable.is_file() {
        if let Err(error) = validate_config(app, &candidate_path) {
            let _ = fs::remove_file(&candidate_path);
            return Err(format!("删除订阅后的 Mihomo 配置校验失败：{error}"));
        }
    }

    let active_path = core_dir.join(ACTIVE_CONFIG_NAME);
    let active_backup = FileBackup::capture(active_path.clone())?;
    if let Err(error) = replace_file(&active_path, candidate_content.as_bytes()) {
        let _ = fs::remove_file(&candidate_path);
        return Err(format!("替换删除订阅后的有效配置失败：{error}"));
    }
    let _ = fs::remove_file(&candidate_path);

    if let Some(controller) = &controller {
        if let Err(error) = controller.reload_config(&candidate_content).await {
            let rollback = rollback_applied_files(
                controller,
                &active_backup,
                std::slice::from_ref(&cache_backup),
            )
            .await;
            return Err(reload_error_with_rollback(
                format!("删除订阅后通知 Mihomo 热重载失败：{error}"),
                rollback,
            ));
        }
        if let Err(error) = controller.verify_runtime_proxies().await {
            let rollback = rollback_applied_files(
                controller,
                &active_backup,
                std::slice::from_ref(&cache_backup),
            )
            .await;
            return Err(reload_error_with_rollback(
                format!("删除订阅后无法读取 Mihomo 代理节点：{error}"),
                rollback,
            ));
        }
    }

    if let Err(error) = fs::remove_file(&cache_path) {
        let rollback = if let Some(controller) = &controller {
            rollback_applied_files(
                controller,
                &active_backup,
                std::slice::from_ref(&cache_backup),
            )
            .await
        } else {
            restore_active_and_subscriptions(&active_backup, std::slice::from_ref(&cache_backup))
        };
        return Err(with_rollback_result(
            format!("删除订阅缓存失败：{error}"),
            rollback,
        ));
    }

    if controller.is_some() {
        let refreshed = mihomo::refresh_runtime_data(snapshot).await;
        enrich_runtime_nodes(app, refreshed)
    } else {
        prune_removed_subscription_data(
            &mut snapshot,
            &removed_subscription,
            cached_content.as_deref(),
        );
        Ok(snapshot)
    }
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

    let refreshed = mihomo::refresh_runtime_data(snapshot.clone()).await;
    enrich_runtime_nodes(app, refreshed)
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

    apply_runtime_settings(root_mapping, &snapshot.settings)?;

    let mut proxies = take_sequence(root_mapping, "proxies")?;
    let mut groups = take_sequence(root_mapping, "proxy-groups")?;
    let mut providers = take_mapping(root_mapping, "proxy-providers")?;
    let mut rules = take_sequence(root_mapping, "rules")?;
    let mut rule_providers = take_mapping(root_mapping, "rule-providers")?;
    if !has_custom_base(snapshot) {
        rules.clear();
    }
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
            &mut rules,
            &mut rule_providers,
        )?;
    }

    apply_local_proxy_groups(&mut groups, snapshot)?;
    apply_proxy_group_overrides(&mut groups, snapshot)?;
    apply_local_rules(&mut rules, snapshot);
    apply_rule_overrides(&mut rules, snapshot)?;
    apply_default_route(&mut rules, &groups, snapshot);
    root_mapping.insert(key("proxies"), Value::Sequence(proxies));
    root_mapping.insert(key("proxy-groups"), Value::Sequence(groups));
    root_mapping.insert(key("rules"), Value::Sequence(rules));
    if !providers.is_empty() {
        root_mapping.insert(key("proxy-providers"), Value::Mapping(providers));
    }
    if !rule_providers.is_empty() {
        root_mapping.insert(key("rule-providers"), Value::Mapping(rule_providers));
    }
    serde_yaml::to_string(&root).map_err(|error| format!("序列化合并配置失败：{error}"))
}

fn apply_local_proxy_groups(groups: &mut Vec<Value>, snapshot: &AppSnapshot) -> Result<(), String> {
    let mut existing_names = groups
        .iter()
        .filter_map(item_name)
        .map(ToString::to_string)
        .collect::<HashSet<_>>();
    let node_names = snapshot
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.name.as_str()))
        .collect::<HashMap<_, _>>();
    let group_names = snapshot
        .groups
        .iter()
        .map(|group| (group.id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();

    for group in snapshot
        .groups
        .iter()
        .filter(|group| group.origin == "local")
    {
        if !existing_names.insert(group.name.clone()) {
            return Err(format!("本地代理组“{}”与订阅代理组重名", group.name));
        }

        let mut member_names = Vec::new();
        for member_id in group.node_ids.iter().chain(&group.group_ids) {
            let member_name = node_names
                .get(member_id.as_str())
                .or_else(|| group_names.get(member_id.as_str()))
                .ok_or_else(|| {
                    format!("本地代理组“{}”包含已不存在的成员 {member_id}", group.name)
                })?;
            if *member_name == group.name {
                return Err(format!("本地代理组“{}”不能引用自身", group.name));
            }
            if !member_names.contains(member_name) {
                member_names.push(*member_name);
            }
        }
        if member_names.is_empty() {
            return Err(format!("本地代理组“{}”至少需要一个成员", group.name));
        }

        let mut value = Mapping::new();
        value.insert(key("name"), Value::String(group.name.clone()));
        value.insert(
            key("type"),
            Value::String(
                match group.group_type.as_str() {
                    "Fallback" => "fallback",
                    "URL-Test" => "url-test",
                    "Load-Balance" => "load-balance",
                    _ => "select",
                }
                .into(),
            ),
        );
        value.insert(
            key("proxies"),
            Value::Sequence(
                member_names
                    .into_iter()
                    .map(|name| Value::String(name.to_string()))
                    .collect(),
            ),
        );
        if matches!(
            group.group_type.as_str(),
            "Fallback" | "URL-Test" | "Load-Balance"
        ) {
            value.insert(
                key("url"),
                Value::String("https://www.gstatic.com/generate_204".into()),
            );
            value.insert(key("interval"), Value::Number(300.into()));
        }
        if group.group_type == "Load-Balance" {
            value.insert(key("strategy"), Value::String("round-robin".into()));
        }
        if !group.icon.trim().is_empty() {
            value.insert(key("icon"), Value::String(group.icon.clone()));
        }
        groups.push(Value::Mapping(value));
    }

    Ok(())
}

fn apply_proxy_group_overrides(groups: &mut [Value], snapshot: &AppSnapshot) -> Result<(), String> {
    let local_group_names = snapshot
        .groups
        .iter()
        .filter(|group| group.origin == "local")
        .map(|group| (group.id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();

    for group_override in &snapshot.proxy_group_overrides {
        let Some(target) = groups
            .iter_mut()
            .find(|group| item_name(group) == Some(group_override.target_group_name.as_str()))
        else {
            continue;
        };
        let target_mapping = target.as_mapping_mut().ok_or_else(|| {
            format!(
                "托管代理组“{}”配置格式无效",
                group_override.target_group_name
            )
        })?;
        if !target_mapping.contains_key(key("proxies")) {
            target_mapping.insert(key("proxies"), Value::Sequence(Vec::new()));
        }
        let members = target_mapping
            .get_mut(key("proxies"))
            .and_then(Value::as_sequence_mut)
            .ok_or_else(|| {
                format!(
                    "托管代理组“{}”的 proxies 必须是数组",
                    group_override.target_group_name
                )
            })?;

        for group_id in &group_override.added_group_ids {
            let Some(group_name) = local_group_names.get(group_id.as_str()) else {
                continue;
            };
            if **group_name == group_override.target_group_name {
                return Err(format!(
                    "托管代理组“{}”不能通过本地覆写引用自身",
                    group_override.target_group_name
                ));
            }
            if !members
                .iter()
                .any(|member| member.as_str() == Some(group_name))
            {
                members.push(Value::String((*group_name).to_string()));
            }
        }
    }

    Ok(())
}

fn apply_local_rules(rules: &mut Vec<Value>, snapshot: &AppSnapshot) {
    let mut local_rules = snapshot
        .rules
        .iter()
        .filter(|rule| rule.source == "local" && rule.enabled)
        .map(|rule| {
            let mut parts = if rule.rule_type == "MATCH" {
                vec!["MATCH".to_string(), rule.policy.clone()]
            } else {
                vec![
                    rule.rule_type.clone(),
                    rule.content.clone(),
                    rule.policy.clone(),
                ]
            };
            if rule.no_resolve {
                parts.push("no-resolve".into());
            }
            Value::String(parts.join(","))
        })
        .collect::<Vec<_>>();
    merge_rules(&mut local_rules, std::mem::take(rules));
    *rules = local_rules;
}

fn apply_rule_overrides(rules: &mut Vec<Value>, snapshot: &AppSnapshot) -> Result<(), String> {
    for rule_override in &snapshot.rule_overrides {
        let Some(index) = rules.iter().position(|rule| {
            rule_signature(rule).is_some_and(|(rule_type, content, _)| {
                rule_type == rule_override.target_rule_type
                    && content == rule_override.target_content
            })
        }) else {
            continue;
        };

        if !rule_override.enabled {
            rules.remove(index);
            continue;
        }

        let raw = rules[index]
            .as_str()
            .ok_or_else(|| "本地规则覆写仅支持字符串格式规则".to_string())?;
        let mut parts = raw
            .split(',')
            .map(|part| part.trim().to_string())
            .collect::<Vec<_>>();
        let policy_index =
            if normalized_rule_type(parts.first().map(String::as_str).unwrap_or("")) == "MATCH" {
                1
            } else {
                2
            };
        if parts.len() <= policy_index {
            return Err(format!(
                "托管规则“{} {}”格式无效",
                rule_override.target_rule_type, rule_override.target_content
            ));
        }
        parts[policy_index] = rule_override.policy.clone();
        parts.retain(|part| !part.eq_ignore_ascii_case("no-resolve"));
        if rule_override.no_resolve {
            parts.push("no-resolve".into());
        }
        rules[index] = Value::String(parts.join(","));
    }

    Ok(())
}

fn apply_runtime_settings(root: &mut Mapping, settings: &SettingsMap) -> Result<(), String> {
    root.insert(
        key("find-process-mode"),
        Value::String(
            match setting_string(settings, "processMode", "Always")
                .to_ascii_lowercase()
                .as_str()
            {
                "always" | "始终" => "always",
                "off" | "关闭" => "off",
                _ => "strict",
            }
            .into(),
        ),
    );
    let mut tun = root
        .remove(key("tun"))
        .map(|value| {
            value
                .as_mapping()
                .cloned()
                .ok_or_else(|| "基础配置的 tun 必须是 YAML 对象".to_string())
        })
        .transpose()?
        .unwrap_or_default();
    tun.insert(
        key("enable"),
        Value::Bool(setting_bool(settings, "tunMode", false)),
    );
    tun.insert(
        key("stack"),
        Value::String(map_tun_stack(&setting_string(
            settings,
            "networkStack",
            "Mixed",
        ))),
    );
    let tun_device = if cfg!(target_os = "macos") {
        "utun"
    } else {
        "Meta"
    };
    tun.insert(key("device"), Value::String(tun_device.into()));
    tun.insert(
        key("dns-hijack"),
        Value::Sequence(vec![
            Value::String("any:53".into()),
            Value::String("tcp://any:53".into()),
        ]),
    );
    tun.insert(
        key("auto-route"),
        Value::Bool(setting_bool(settings, "autoRoute", true)),
    );
    tun.insert(
        key("strict-route"),
        Value::Bool(setting_bool(settings, "strictRoute", false)),
    );

    let interface = setting_string(settings, "networkInterface", "系统默认");
    let auto_detect_interface = interface == "系统默认";
    tun.insert(
        key("auto-detect-interface"),
        Value::Bool(auto_detect_interface),
    );
    if auto_detect_interface {
        root.remove(key("interface-name"));
    } else {
        root.insert(key("interface-name"), Value::String(interface));
    }
    root.insert(key("tun"), Value::Mapping(tun));

    let mut dns = root
        .remove(key("dns"))
        .map(|value| {
            value
                .as_mapping()
                .cloned()
                .ok_or_else(|| "基础配置的 dns 必须是 YAML 对象".to_string())
        })
        .transpose()?
        .unwrap_or_default();
    dns.insert(
        key("enable"),
        Value::Bool(setting_bool(settings, "dnsEnabled", true)),
    );
    dns.insert(
        key("listen"),
        Value::String(setting_string(settings, "dnsListen", "0.0.0.0:1053")),
    );
    dns.insert(
        key("ipv6"),
        Value::Bool(setting_bool(settings, "dnsIpv6", false)),
    );
    dns.insert(
        key("enhanced-mode"),
        Value::String(map_enhanced_mode(&setting_string(
            settings,
            "enhancedMode",
            "Fake-IP",
        ))),
    );
    dns.insert(
        key("fake-ip-range"),
        Value::String(setting_string(settings, "fakeIpRange", "198.18.0.1/16")),
    );
    dns.insert(
        key("use-hosts"),
        Value::Bool(setting_bool(settings, "useHosts", true)),
    );
    dns.insert(
        key("default-nameserver"),
        setting_string_sequence(settings, "defaultDns", &["223.5.5.5", "119.29.29.29"]),
    );
    dns.insert(
        key("nameserver"),
        setting_string_sequence(
            settings,
            "proxyDns",
            &["tls://1.1.1.1", "https://dns.google/dns-query"],
        ),
    );
    dns.insert(
        key("fallback"),
        setting_string_sequence(settings, "fallbackDns", &["1.0.0.1", "8.8.8.8"]),
    );
    dns.insert(
        key("fake-ip-filter"),
        Value::Sequence(
            setting_string(settings, "fakeIpFilter", "*.lan\nlocalhost\nstun.*.*")
                .lines()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| Value::String(value.to_string()))
                .collect(),
        ),
    );
    root.insert(key("dns"), Value::Mapping(dns));
    Ok(())
}

fn apply_default_route(rules: &mut Vec<Value>, groups: &[Value], snapshot: &AppSnapshot) {
    if rules.iter().any(is_terminal_rule) {
        return;
    }

    let selected_group_name = snapshot
        .groups
        .iter()
        .find(|group| group.id == snapshot.selected_group_id)
        .map(|group| group.name.as_str())
        .filter(|selected| {
            groups
                .iter()
                .filter_map(item_name)
                .any(|name| name == *selected)
        });
    let target = selected_group_name
        .or_else(|| groups.first().and_then(item_name))
        .unwrap_or("DIRECT");
    rules.push(Value::String(format!("MATCH,{target}")));
}

fn has_custom_base(snapshot: &AppSnapshot) -> bool {
    snapshot
        .settings
        .get("configOverride")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty())
}

fn setting_bool(settings: &SettingsMap, name: &str, fallback: bool) -> bool {
    settings
        .get(name)
        .and_then(|value| value.as_bool())
        .unwrap_or(fallback)
}

fn setting_string(settings: &SettingsMap, name: &str, fallback: &str) -> String {
    settings
        .get(name)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn setting_string_sequence(settings: &SettingsMap, name: &str, fallback: &[&str]) -> Value {
    let values = settings
        .get(name)
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str())
                .map(|value| Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| {
            fallback
                .iter()
                .map(|value| Value::String((*value).to_string()))
                .collect()
        });
    Value::Sequence(values)
}

fn map_tun_stack(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "system" => "system",
        "gvisor" => "gvisor",
        _ => "mixed",
    }
    .into()
}

fn map_enhanced_mode(value: &str) -> String {
    if value.eq_ignore_ascii_case("Redir-Host") {
        "redir-host"
    } else {
        "fake-ip"
    }
    .into()
}

pub(crate) fn enrich_runtime_nodes(
    app: &AppHandle,
    mut snapshot: AppSnapshot,
) -> Result<AppSnapshot, String> {
    let config_path = core::core_dir(app)?.join(ACTIVE_CONFIG_NAME);
    if !config_path.is_file() {
        return Ok(snapshot);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取生效配置中的节点详情失败：{error}"))?;
    enrich_nodes_from_config(&mut snapshot.nodes, &content)?;
    Ok(snapshot)
}

fn enrich_nodes_from_config(nodes: &mut [ProxyNode], content: &str) -> Result<(), String> {
    let root = serde_yaml::from_str::<Value>(content)
        .map_err(|error| format!("生效配置不是有效 YAML：{error}"))?;
    let configured_nodes = root
        .as_mapping()
        .and_then(|mapping| mapping.get(key("proxies")))
        .and_then(Value::as_sequence)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let configured_by_name = configured_nodes
        .iter()
        .filter_map(|value| item_name(value).map(|name| (name, value)))
        .collect::<HashMap<_, _>>();

    for node in nodes {
        let Some(configured) = configured_by_name.get(node.name.as_str()) else {
            continue;
        };
        let Some(mapping) = configured.as_mapping() else {
            continue;
        };

        if let Some(address) = mapping.get(key("server")).and_then(yaml_scalar_string) {
            node.address = address;
        }
        if let Some(port) = mapping.get(key("port")).and_then(yaml_u16) {
            node.port = port;
        }
        if let Some(cipher) = mapping.get(key("cipher")).and_then(yaml_scalar_string) {
            node.cipher = Some(cipher);
        }
        if let Some(dialer_proxy) = mapping
            .get(key("dialer-proxy"))
            .and_then(yaml_scalar_string)
        {
            node.dialer_proxy = Some(dialer_proxy);
        }
    }

    Ok(())
}

fn yaml_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn yaml_u16(value: &Value) -> Option<u16> {
    value
        .as_u64()
        .and_then(|value| u16::try_from(value).ok())
        .or_else(|| value.as_str().and_then(|value| value.parse::<u16>().ok()))
}

fn merge_parsed_subscription(
    subscription: &Subscription,
    parsed: ParsedSubscription,
    proxies: &mut Vec<Value>,
    groups: &mut Vec<Value>,
    providers: &mut Mapping,
    rules: &mut Vec<Value>,
    rule_providers: &mut Mapping,
) -> Result<(), String> {
    match parsed {
        ParsedSubscription::ClashConfig {
            proxies: incoming_proxies,
            groups: incoming_groups,
            providers: incoming_providers,
            rules: incoming_rules,
            rule_providers: incoming_rule_providers,
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
            merge_mapping(
                rule_providers,
                incoming_rule_providers,
                subscription.allow_override,
                "规则 Provider",
            )?;
            merge_rules(rules, incoming_rules);
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
        let rules = mapping
            .get(key("rules"))
            .and_then(Value::as_sequence)
            .cloned()
            .unwrap_or_default();
        let rule_providers = mapping
            .get(key("rule-providers"))
            .and_then(Value::as_mapping)
            .cloned()
            .unwrap_or_default();
        if !proxies.is_empty()
            || !groups.is_empty()
            || !providers.is_empty()
            || !rules.is_empty()
            || !rule_providers.is_empty()
        {
            return Ok(ParsedSubscription::ClashConfig {
                proxies,
                groups,
                providers,
                rules,
                rule_providers,
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

fn merge_rules(target: &mut Vec<Value>, incoming: Vec<Value>) {
    let mut merged = Vec::with_capacity(target.len() + incoming.len());
    let mut terminal_rule = None;

    for rule in target.drain(..).chain(incoming) {
        if is_terminal_rule(&rule) {
            if terminal_rule.is_none() {
                terminal_rule = Some(rule);
            }
        } else {
            merged.push(rule);
        }
    }

    if let Some(rule) = terminal_rule {
        merged.push(rule);
    }
    *target = merged;
}

fn is_terminal_rule(rule: &Value) -> bool {
    rule.as_str()
        .and_then(|rule| rule.split(',').next())
        .is_some_and(|rule_type| rule_type.trim().eq_ignore_ascii_case("MATCH"))
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

fn prune_removed_subscription_data(
    snapshot: &mut AppSnapshot,
    subscription: &Subscription,
    content: Option<&str>,
) {
    let mut node_names = HashSet::new();
    let mut group_names = HashSet::new();
    let mut rule_signatures = HashSet::new();
    let managed_provider = provider_name(&subscription.id);

    if let Some(content) = content {
        match parse_subscription(content) {
            Ok(ParsedSubscription::ClashConfig {
                proxies,
                groups,
                providers,
                rules,
                ..
            }) => {
                node_names.extend(
                    proxies
                        .iter()
                        .filter_map(item_name)
                        .map(ToString::to_string),
                );
                group_names.extend(groups.iter().filter_map(item_name).map(ToString::to_string));
                if group_names.is_empty() && (!node_names.is_empty() || !providers.is_empty()) {
                    group_names.insert(subscription.name.clone());
                }
                rule_signatures.extend(rules.iter().filter_map(rule_signature));
            }
            Ok(ParsedSubscription::ProviderContent) | Err(_) => {
                group_names.insert(subscription.name.clone());
            }
        }
    } else {
        group_names.insert(subscription.name.clone());
    }

    snapshot.nodes.retain(|node| {
        node.origin != "managed"
            || (!node_names.contains(&node.name)
                && node.group.as_deref() != Some(managed_provider.as_str()))
    });
    let retained_node_ids = snapshot
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    snapshot
        .groups
        .retain(|group| group.origin != "managed" || !group_names.contains(&group.name));
    let retained_group_ids = snapshot
        .groups
        .iter()
        .map(|group| group.id.clone())
        .collect::<HashSet<_>>();
    for group in &mut snapshot.groups {
        group.node_ids.retain(|id| retained_node_ids.contains(id));
        group.group_ids.retain(|id| retained_group_ids.contains(id));
        if group
            .current_node_id
            .as_ref()
            .is_some_and(|id| !retained_node_ids.contains(id) && !retained_group_ids.contains(id))
        {
            group.current_node_id = group
                .node_ids
                .first()
                .cloned()
                .or_else(|| group.group_ids.first().cloned());
        }
    }
    snapshot.rules.retain(|rule| {
        rule.source != "managed"
            || !rule_signatures.contains(&(
                rule.rule_type.clone(),
                rule.content.clone(),
                rule.policy.clone(),
            ))
    });

    if !snapshot
        .groups
        .iter()
        .any(|group| group.id == snapshot.selected_group_id)
    {
        snapshot.selected_group_id = snapshot
            .groups
            .first()
            .map(|group| group.id.clone())
            .unwrap_or_default();
    }
    if !snapshot
        .nodes
        .iter()
        .any(|node| node.id == snapshot.selected_node_id)
    {
        snapshot.selected_node_id = snapshot
            .nodes
            .first()
            .map(|node| node.id.clone())
            .unwrap_or_default();
    }
}

fn rule_signature(rule: &Value) -> Option<(String, String, String)> {
    let values = rule.as_str()?.split(',').map(str::trim).collect::<Vec<_>>();
    let rule_type = normalized_rule_type(values.first()?);
    if rule_type == "MATCH" {
        return Some((
            rule_type.clone(),
            rule_type,
            values.get(1).unwrap_or(&"DIRECT").to_string(),
        ));
    }
    Some((
        rule_type,
        values.get(1)?.to_string(),
        values.get(2)?.to_string(),
    ))
}

fn normalized_rule_type(value: &str) -> String {
    match value.to_ascii_uppercase().replace('_', "-").as_str() {
        "DOMAINSUFFIX" | "DOMAIN-SUFFIX" => "DOMAIN-SUFFIX",
        "DOMAINKEYWORD" | "DOMAIN-KEYWORD" => "DOMAIN-KEYWORD",
        "IPCIDR" | "IP-CIDR" | "IP-CIDR6" => "IP-CIDR",
        "RULESET" | "RULE-SET" => "RULE-SET",
        value => value,
    }
    .into()
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

    fn proxy_group(
        id: &str,
        name: &str,
        origin: &str,
        group_ids: Vec<String>,
    ) -> crate::models::ProxyGroup {
        crate::models::ProxyGroup {
            id: id.into(),
            name: name.into(),
            group_type: "Selector".into(),
            origin: origin.into(),
            icon: String::new(),
            description: String::new(),
            node_ids: Vec::new(),
            group_ids,
            current_node_id: None,
            auto_test: false,
            allow_manual: true,
        }
    }

    fn group_with_members(name: &str, members: &[&str]) -> Value {
        let mut group = Mapping::new();
        group.insert(key("name"), Value::String(name.into()));
        group.insert(key("type"), Value::String("select".into()));
        group.insert(
            key("proxies"),
            Value::Sequence(
                members
                    .iter()
                    .map(|member| Value::String((*member).into()))
                    .collect(),
            ),
        );
        Value::Mapping(group)
    }

    #[test]
    fn serializes_local_process_rules_before_managed_rules() {
        let mut snapshot = crate::defaults::default_snapshot();
        snapshot.rules.extend([
            crate::models::RoutingRule {
                id: "process-name".into(),
                rule_type: "PROCESS-NAME".into(),
                content: "chrome.exe".into(),
                policy: "浏览器代理".into(),
                source: "local".into(),
                enabled: true,
                no_resolve: false,
                wildcard: false,
                note: None,
            },
            crate::models::RoutingRule {
                id: "process-path".into(),
                rule_type: "PROCESS-PATH".into(),
                content: "C:\\Apps\\Example.exe".into(),
                policy: "DIRECT".into(),
                source: "local".into(),
                enabled: true,
                no_resolve: false,
                wildcard: false,
                note: None,
            },
        ]);
        let mut rules = vec![Value::String("DOMAIN-SUFFIX,example.com,托管代理".into())];

        apply_local_rules(&mut rules, &snapshot);

        assert_eq!(
            rules,
            vec![
                Value::String("PROCESS-NAME,chrome.exe,浏览器代理".into()),
                Value::String("PROCESS-PATH,C:\\Apps\\Example.exe,DIRECT".into()),
                Value::String("DOMAIN-SUFFIX,example.com,托管代理".into()),
            ]
        );
    }

    #[test]
    fn reapplies_local_group_override_after_subscription_groups_change() {
        let mut snapshot = crate::defaults::default_snapshot();
        snapshot.groups.extend([
            proxy_group("base", "节点选择", "managed", Vec::new()),
            proxy_group("ai", "AI", "managed", Vec::new()),
            proxy_group("local", "手动前置", "local", vec!["base".into()]),
        ]);
        snapshot
            .proxy_group_overrides
            .push(crate::models::ProxyGroupMemberOverride {
                target_group_id: "ai".into(),
                target_group_name: "AI".into(),
                added_group_ids: vec!["local".into()],
            });

        for subscription_members in [vec!["节点选择"], vec!["自动选择"]] {
            let mut groups = vec![
                group_with_members("AI", &subscription_members),
                group_with_members("节点选择", &["DIRECT"]),
                group_with_members("自动选择", &["DIRECT"]),
            ];

            apply_local_proxy_groups(&mut groups, &snapshot).expect("应写入本地代理组");
            apply_proxy_group_overrides(&mut groups, &snapshot).expect("应重新叠加本地覆写");

            let ai_members = groups
                .iter()
                .find(|group| item_name(group) == Some("AI"))
                .and_then(Value::as_mapping)
                .and_then(|group| group.get(key("proxies")))
                .and_then(Value::as_sequence)
                .expect("AI 应包含成员");
            assert!(ai_members
                .iter()
                .any(|member| member.as_str() == Some("手动前置")));
            assert!(groups
                .iter()
                .any(|group| item_name(group) == Some("手动前置")));
        }
    }

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
    fn parses_rules_only_clash_yaml() {
        let yaml = "rule-providers:\n  reject:\n    type: http\n    url: https://example.com/reject.yaml\nrules:\n  - RULE-SET,reject,REJECT\n  - MATCH,DIRECT\n";
        let parsed = parse_subscription(yaml).expect("应解析仅包含规则的 Clash 配置");

        match parsed {
            ParsedSubscription::ClashConfig {
                rules,
                rule_providers,
                ..
            } => {
                assert_eq!(rules.len(), 2);
                assert!(rule_providers.contains_key(key("reject")));
            }
            ParsedSubscription::ProviderContent => panic!("不应解析为节点 Provider"),
        }
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
        let mut rules = Vec::new();
        let mut rule_providers = Mapping::new();
        merge_parsed_subscription(
            &subscription(false),
            parsed,
            &mut proxies,
            &mut groups,
            &mut providers,
            &mut rules,
            &mut rule_providers,
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
        assert!(rules.is_empty());
        assert!(rule_providers.is_empty());
    }

    #[test]
    fn merges_subscription_rules_and_rule_providers() {
        let parsed = parse_subscription(
            "rule-providers:\n  reject:\n    type: http\n    url: https://example.com/reject.yaml\nrules:\n  - RULE-SET,reject,REJECT\n  - MATCH,DIRECT\n",
        )
        .expect("应解析订阅规则");
        let mut proxies = Vec::new();
        let mut groups = Vec::new();
        let mut providers = Mapping::new();
        let mut rules = Vec::new();
        let mut rule_providers = Mapping::new();

        merge_parsed_subscription(
            &subscription(false),
            parsed,
            &mut proxies,
            &mut groups,
            &mut providers,
            &mut rules,
            &mut rule_providers,
        )
        .expect("应合并订阅规则");

        assert!(rule_providers.contains_key(key("reject")));
        assert_eq!(rules[0].as_str(), Some("RULE-SET,reject,REJECT"));
        assert_eq!(rules[1].as_str(), Some("MATCH,DIRECT"));
    }

    #[test]
    fn keeps_single_match_rule_at_the_end() {
        let mut rules = vec![Value::String("DOMAIN,first.example,DIRECT".into())];
        merge_rules(
            &mut rules,
            vec![
                Value::String("MATCH,代理".into()),
                Value::String("DOMAIN,second.example,REJECT".into()),
            ],
        );
        merge_rules(
            &mut rules,
            vec![
                Value::String("DOMAIN,third.example,DIRECT".into()),
                Value::String("MATCH,DIRECT".into()),
            ],
        );

        assert_eq!(rules.len(), 4);
        assert_eq!(rules.last().and_then(Value::as_str), Some("MATCH,代理"));
        assert_eq!(
            rules.iter().filter(|rule| is_terminal_rule(rule)).count(),
            1
        );
    }

    #[test]
    fn keeps_imported_rules_instead_of_applying_default_route() {
        let mut rules = vec![
            Value::String("DOMAIN-SUFFIX,example.com,REJECT".into()),
            Value::String("MATCH,DIRECT".into()),
        ];
        let snapshot = crate::defaults::default_snapshot();

        apply_default_route(&mut rules, &[named_item("自动选择")], &snapshot);

        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].as_str(), Some("DOMAIN-SUFFIX,example.com,REJECT"));
        assert_eq!(rules[1].as_str(), Some("MATCH,DIRECT"));
    }

    #[test]
    fn creates_file_provider_and_group_for_base64_subscription() {
        let mut proxies = Vec::new();
        let mut groups = Vec::new();
        let mut providers = Mapping::new();
        let mut rules = Vec::new();
        let mut rule_providers = Mapping::new();
        merge_parsed_subscription(
            &subscription(false),
            ParsedSubscription::ProviderContent,
            &mut proxies,
            &mut groups,
            &mut providers,
            &mut rules,
            &mut rule_providers,
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
    fn applies_tun_dns_and_proxy_route_from_settings() {
        let mut settings = crate::defaults::default_settings();
        settings.insert("tunMode".into(), serde_json::json!(true));
        settings.insert("networkStack".into(), serde_json::json!("gVisor"));
        settings.insert("strictRoute".into(), serde_json::json!(true));
        let mut root = Mapping::new();

        apply_runtime_settings(&mut root, &settings).expect("应生成 TUN 与 DNS 配置");
        let mut snapshot = crate::defaults::default_snapshot();
        snapshot.settings = settings;
        let mut rules = Vec::new();
        apply_default_route(&mut rules, &[named_item("自动选择")], &snapshot);

        let tun = root
            .get(key("tun"))
            .and_then(Value::as_mapping)
            .expect("应包含 TUN 配置");
        assert_eq!(tun.get(key("enable")).and_then(Value::as_bool), Some(true));
        assert_eq!(
            tun.get(key("stack")).and_then(Value::as_str),
            Some("gvisor")
        );
        let expected_device = if cfg!(target_os = "macos") {
            "utun"
        } else {
            "Meta"
        };
        assert_eq!(
            tun.get(key("device")).and_then(Value::as_str),
            Some(expected_device)
        );
        assert_eq!(
            tun.get(key("strict-route")).and_then(Value::as_bool),
            Some(true)
        );
        assert!(root
            .get(key("dns"))
            .and_then(Value::as_mapping)
            .and_then(|dns| dns.get(key("enable")))
            .and_then(Value::as_bool)
            .unwrap_or(false));
        assert_eq!(
            rules.first().and_then(Value::as_str),
            Some("MATCH,自动选择")
        );
    }

    #[test]
    fn enriches_runtime_node_endpoint_without_copying_credentials() {
        let mut snapshot = crate::defaults::default_snapshot();
        snapshot.nodes.push(ProxyNode {
            id: "node-tr".into(),
            name: "土耳其A[GCPxAWS]".into(),
            country: None,
            flag: None,
            protocol: "Vless".into(),
            address: String::new(),
            port: 0,
            latency: 389,
            password: None,
            cipher: None,
            dialer_proxy: None,
            group: None,
            origin: "managed".into(),
            available: true,
        });
        let config = "proxies:\n  - name: 土耳其A[GCPxAWS]\n    type: vless\n    server: tr.example.com\n    port: '53355'\n    uuid: private-value\n    cipher: auto\n";

        enrich_nodes_from_config(&mut snapshot.nodes, config).expect("应回填节点详情");

        let node = &snapshot.nodes[0];
        assert_eq!(node.address, "tr.example.com");
        assert_eq!(node.port, 53355);
        assert_eq!(node.cipher.as_deref(), Some("auto"));
        assert!(node.password.is_none());
        assert_eq!(node.latency, 389);
    }

    #[test]
    fn prunes_only_data_owned_by_deleted_subscription() {
        let mut snapshot = crate::defaults::default_snapshot();
        for (id, name) in [("node-hk", "HK"), ("node-us", "US")] {
            snapshot.nodes.push(ProxyNode {
                id: id.into(),
                name: name.into(),
                country: None,
                flag: None,
                protocol: "SS".into(),
                address: String::new(),
                port: 0,
                latency: 0,
                password: None,
                cipher: None,
                dialer_proxy: None,
                group: None,
                origin: "managed".into(),
                available: true,
            });
        }
        snapshot.groups.extend([
            crate::models::ProxyGroup {
                id: "group-removed".into(),
                name: "自动选择".into(),
                group_type: "Selector".into(),
                origin: "managed".into(),
                icon: String::new(),
                description: String::new(),
                node_ids: vec!["node-hk".into()],
                group_ids: Vec::new(),
                current_node_id: Some("node-hk".into()),
                auto_test: false,
                allow_manual: true,
            },
            crate::models::ProxyGroup {
                id: "group-kept".into(),
                name: "保留分组".into(),
                group_type: "Selector".into(),
                origin: "managed".into(),
                icon: String::new(),
                description: String::new(),
                node_ids: vec!["node-us".into()],
                group_ids: Vec::new(),
                current_node_id: Some("node-us".into()),
                auto_test: false,
                allow_manual: true,
            },
        ]);
        snapshot.rules.extend([
            crate::models::RoutingRule {
                id: "rule-removed".into(),
                rule_type: "DOMAIN-SUFFIX".into(),
                content: "example.com".into(),
                policy: "REJECT".into(),
                source: "managed".into(),
                enabled: true,
                no_resolve: false,
                wildcard: false,
                note: None,
            },
            crate::models::RoutingRule {
                id: "rule-kept".into(),
                rule_type: "DOMAIN".into(),
                content: "keep.example".into(),
                policy: "DIRECT".into(),
                source: "managed".into(),
                enabled: true,
                no_resolve: false,
                wildcard: false,
                note: None,
            },
        ]);
        snapshot.selected_node_id = "node-hk".into();
        snapshot.selected_group_id = "group-removed".into();
        let content = "proxies:\n  - name: HK\n    type: ss\nproxy-groups:\n  - name: 自动选择\n    type: select\n    proxies: [HK]\nrules:\n  - DOMAIN-SUFFIX,example.com,REJECT\n";

        prune_removed_subscription_data(&mut snapshot, &subscription(false), Some(content));

        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.nodes[0].name, "US");
        assert_eq!(snapshot.groups.len(), 1);
        assert_eq!(snapshot.groups[0].name, "保留分组");
        assert_eq!(snapshot.rules.len(), 1);
        assert_eq!(snapshot.rules[0].content, "keep.example");
        assert_eq!(snapshot.selected_node_id, "node-us");
        assert_eq!(snapshot.selected_group_id, "group-kept");
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
