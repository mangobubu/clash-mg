use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use chrono::{DateTime, Local, Utc};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::{header::AUTHORIZATION, Client};
use serde_json::{json, Value};

use crate::{
    app_icon::application_icon_data_url,
    defaults::{current_time, value_to_string},
    models::{
        AppSnapshot, Connection, ConnectionRefreshResult, DelayResult, LogEntry, ProxyGroup,
        ProxyNode, RoutingRule, RuntimeInfo, SettingsMap, TrafficPoint,
    },
};

const MANAGED_ORIGIN: &str = "managed";
const DEFAULT_TEST_URL: &str = "https://www.gstatic.com/generate_204";
const DELAY_TEST_TIMEOUT_MS: u64 = 10_000;
const DELAY_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const TRAFFIC_HISTORY_BUCKET_MS: i64 = 5 * 60 * 1000;
const TRAFFIC_HISTORY_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

fn setting_bool(settings: &SettingsMap, key: &str, fallback: bool) -> bool {
    settings
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

pub struct MihomoClient {
    base_url: String,
    secret: Option<String>,
    client: Client,
}

impl MihomoClient {
    pub fn from_settings(settings: &SettingsMap) -> Option<Self> {
        let base_url = controller_base_url(settings)?;
        let secret = settings
            .get("uiSecret")
            .and_then(value_to_string)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .ok()?;

        Some(Self {
            base_url,
            secret,
            client,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn get_json(&self, path: &str) -> Result<Value, String> {
        self.get_json_with_timeout(path, Duration::from_secs(3))
            .await
    }

    async fn get_json_with_timeout(&self, path: &str, timeout: Duration) -> Result<Value, String> {
        let response = self
            .with_auth(self.client.get(self.url(path)).timeout(timeout))
            .send()
            .await
            .map_err(format_request_error)?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("控制器返回 HTTP {status}"));
        }

        response
            .json::<Value>()
            .await
            .map_err(|error| error.to_string())
    }

    async fn put_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .with_auth(self.client.put(self.url(path)).json(&body))
            .send()
            .await
            .map_err(|error| error.to_string())?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("控制器返回 HTTP {status}"));
        }

        response.json::<Value>().await.or_else(|_| Ok(json!({})))
    }

    async fn post_json(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .with_auth(self.client.post(self.url(path)).json(&body))
            .send()
            .await
            .map_err(format_request_error)?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("控制器返回 HTTP {status}"));
        }

        response.json::<Value>().await.or_else(|_| Ok(json!({})))
    }

    pub async fn reload_config(&self, payload: &str) -> Result<(), String> {
        self.put_json(
            "/configs?force=true",
            json!({ "path": "", "payload": payload }),
        )
        .await
        .map(|_| ())
    }

    pub async fn restart_config(&self, payload: &str) -> Result<(), String> {
        self.post_json("/restart", json!({ "path": "", "payload": payload }))
            .await
            .map(|_| ())
    }

    pub async fn verify_runtime_proxies(&self) -> Result<(), String> {
        self.get_json("/proxies").await.map(|_| ())
    }

    pub async fn runtime_tun_enabled(&self) -> Result<bool, String> {
        self.get_json("/configs").await.and_then(|config| {
            config
                .get("tun")
                .and_then(|tun| tun.get("enable"))
                .and_then(Value::as_bool)
                .ok_or_else(|| "Mihomo 控制器未返回 TUN 运行状态".to_string())
        })
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        let response = self
            .with_auth(self.client.delete(self.url(path)))
            .send()
            .await
            .map_err(|error| error.to_string())?;

        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(format!("控制器返回 HTTP {status}"))
        }
    }

    fn with_auth(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.secret {
            Some(secret) => builder.header(AUTHORIZATION, format!("Bearer {secret}")),
            None => builder,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

pub async fn controller_is_ready(settings: &SettingsMap) -> bool {
    let Some(client) = MihomoClient::from_settings(settings) else {
        return false;
    };

    client.get_json("/version").await.is_ok()
}

pub async fn refresh_runtime_data(mut snapshot: AppSnapshot) -> AppSnapshot {
    snapshot
        .subscriptions
        .retain(|subscription| !subscription.is_runtime_provider_record());

    let Some(client) = MihomoClient::from_settings(&snapshot.settings) else {
        snapshot.runtime = disconnected_runtime("未配置 Mihomo 外部控制器地址", "");
        snapshot.connected = false;
        push_runtime_log(
            &mut snapshot,
            "WARNING",
            "控制器",
            "未配置 Mihomo 外部控制器地址",
        );
        return snapshot;
    };

    let mut runtime = RuntimeInfo {
        controller_connected: true,
        controller_url: client.base_url().to_string(),
        core_version: snapshot.runtime.core_version.clone(),
        upload_total: snapshot.runtime.upload_total.clone(),
        download_total: snapshot.runtime.download_total.clone(),
        last_sync: current_time(),
        tun_enabled: snapshot.runtime.tun_enabled,
        process_mode: snapshot.runtime.process_mode.clone(),
        error: None,
    };

    let mut errors = Vec::new();

    match client.get_json("/version").await {
        Ok(version) => {
            runtime.core_version = version
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("Mihomo")
                .to_string();
        }
        Err(error) => errors.push(format!("版本读取失败：{error}")),
    }

    match client.get_json("/configs").await {
        Ok(config) => {
            runtime.tun_enabled = config
                .get("tun")
                .and_then(|tun| tun.get("enable"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            runtime.process_mode =
                proxy_string(&config, "find-process-mode").unwrap_or_else(|| "strict".into());
        }
        Err(error) => errors.push(format!("运行配置读取失败：{error}")),
    }

    match client.get_json("/proxies").await {
        Ok(proxies) => {
            let selection_corrections = apply_proxies(&mut snapshot, &proxies);
            if setting_bool(&snapshot.settings, "autoConnect", true) {
                for (group_name, proxy_name) in selection_corrections {
                    let path = format!("/proxies/{}", encode_component(&group_name));
                    if let Err(error) = client.put_json(&path, json!({ "name": proxy_name })).await
                    {
                        errors.push(format!("恢复代理组“{group_name}”选择失败：{error}"));
                    }
                }
            }
        }
        Err(error) => errors.push(format!("代理读取失败：{error}")),
    }

    match client.get_json("/connections").await {
        Ok(connections) => {
            match enforce_connection_limit(&client, &snapshot.settings, connections).await {
                Ok((connections, closed)) => {
                    apply_connections(&mut snapshot, &mut runtime, &connections);
                    if closed > 0 {
                        push_runtime_log(
                            &mut snapshot,
                            "WARNING",
                            "连接",
                            &format!("连接数超过并发限制，已关闭 {closed} 条最新连接"),
                        );
                    }
                }
                Err(error) => errors.push(format!("连接并发限制执行失败：{error}")),
            }
        }
        Err(error) => errors.push(format!("连接读取失败：{error}")),
    }

    match client.get_json("/rules").await {
        Ok(rules) => apply_rules(&mut snapshot, &rules),
        Err(error) => errors.push(format!("规则读取失败：{error}")),
    }

    if errors.len() >= 3 && snapshot.nodes.is_empty() && snapshot.connections.is_empty() {
        let message = errors.join("；");
        snapshot.runtime = disconnected_runtime(&message, client.base_url());
        snapshot.connected = false;
        push_runtime_log(&mut snapshot, "ERROR", "控制器", &message);
        return snapshot;
    }

    if !errors.is_empty() {
        runtime.error = Some(errors.join("；"));
        push_runtime_log(
            &mut snapshot,
            "WARNING",
            "控制器",
            runtime.error.as_deref().unwrap_or("运行数据刷新不完整"),
        );
    } else {
        push_runtime_log(
            &mut snapshot,
            "SUCCESS",
            "控制器",
            "运行数据已从 Mihomo 控制器刷新",
        );
    }

    snapshot.connected = true;
    snapshot.runtime = runtime;
    normalize_selection(&mut snapshot);
    snapshot
}

pub async fn refresh_connections(
    settings: SettingsMap,
    nodes: Vec<ProxyNode>,
) -> Result<ConnectionRefreshResult, String> {
    let client = MihomoClient::from_settings(&settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    let value = client.get_json("/connections").await?;
    let (value, _) = enforce_connection_limit(&client, &settings, value).await?;
    let (upload_total, download_total) = connection_totals(&value);

    Ok(ConnectionRefreshResult {
        connections: parse_connections(&value, &nodes),
        upload_total: format_bytes(upload_total),
        download_total: format_bytes(download_total),
    })
}

pub async fn enforce_runtime_connection_limit(settings: SettingsMap) -> Result<usize, String> {
    let limit = connection_limit(&settings);
    if limit == 0 {
        return Ok(0);
    }
    let client = MihomoClient::from_settings(&settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    let value = client.get_json("/connections").await?;
    let (_, closed) = enforce_connection_limit(&client, &settings, value).await?;
    Ok(closed)
}

fn connection_limit(settings: &SettingsMap) -> usize {
    settings
        .get("maxConnections")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0)
}

async fn enforce_connection_limit(
    client: &MihomoClient,
    settings: &SettingsMap,
    value: Value,
) -> Result<(Value, usize), String> {
    let limit = connection_limit(settings);
    if limit == 0 {
        return Ok((value, 0));
    }

    let ids = overflow_connection_ids(&value, limit);
    for id in &ids {
        let path = format!("/connections/{}", encode_component(id));
        client.delete(&path).await?;
    }
    if ids.is_empty() {
        Ok((value, 0))
    } else {
        Ok((client.get_json("/connections").await?, ids.len()))
    }
}

fn overflow_connection_ids(value: &Value, limit: usize) -> Vec<String> {
    let mut connections = value
        .get("connections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|connection| {
            Some((
                connection
                    .get("start")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                connection.get("id").and_then(Value::as_str)?.to_string(),
            ))
        })
        .collect::<Vec<_>>();
    connections.sort_by(|left, right| left.0.cmp(right.0));
    connections
        .into_iter()
        .skip(limit)
        .map(|(_, id)| id)
        .collect()
}

pub async fn select_proxy_node(
    mut snapshot: AppSnapshot,
    group_name: String,
    node_name: String,
) -> Result<AppSnapshot, String> {
    let client = MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    let path = format!("/proxies/{}", encode_component(&group_name));
    client.put_json(&path, json!({ "name": node_name })).await?;

    if let Ok(value) = client.get_json("/connections").await {
        if let Some(connections) = value.get("connections").and_then(Value::as_array) {
            for conn in connections {
                let has_group = conn
                    .get("chains")
                    .and_then(Value::as_array)
                    .map(|chains| {
                        chains
                            .iter()
                            .filter_map(Value::as_str)
                            .any(|c| c == group_name)
                    })
                    .unwrap_or(false);

                if has_group {
                    if let Some(id) = conn.get("id").and_then(Value::as_str) {
                        let delete_path = format!("/connections/{}", encode_component(id));
                        let _ = client.delete(&delete_path).await;
                    }
                }
            }
        }
    }

    push_runtime_log(
        &mut snapshot,
        "SUCCESS",
        "代理",
        &format!("已通过 Mihomo 控制器切换“{group_name}”至“{node_name}”并断开相关旧连接"),
    );
    Ok(refresh_runtime_data(snapshot).await)
}

pub async fn close_connections(
    mut snapshot: AppSnapshot,
    ids: Vec<String>,
) -> Result<AppSnapshot, String> {
    let client = MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;

    for id in ids {
        let path = format!("/connections/{}", encode_component(&id));
        client.delete(&path).await?;
    }

    push_runtime_log(
        &mut snapshot,
        "SUCCESS",
        "连接",
        "已通过 Mihomo 控制器关闭连接",
    );
    Ok(refresh_runtime_data(snapshot).await)
}

pub async fn refresh_proxy_providers(
    mut snapshot: AppSnapshot,
    provider_names: Vec<String>,
) -> Result<AppSnapshot, String> {
    let client = MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;

    for name in provider_names {
        let path = format!("/providers/proxies/{}", encode_component(&name));
        client.put_json(&path, json!({})).await?;
    }

    push_runtime_log(
        &mut snapshot,
        "SUCCESS",
        "订阅",
        "已通过 Mihomo 控制器刷新订阅 Provider",
    );
    Ok(refresh_runtime_data(snapshot).await)
}

pub async fn test_proxy_delay(settings: SettingsMap, node_name: String) -> DelayResult {
    let Some(client) = MihomoClient::from_settings(&settings) else {
        return DelayResult {
            latency: 0,
            available: false,
            message: Some("未配置 Mihomo 外部控制器地址".into()),
        };
    };

    let test_url = settings
        .get("latencyTestUrl")
        .and_then(value_to_string)
        .unwrap_or_else(|| DEFAULT_TEST_URL.into());
    let path = format!(
        "/proxies/{}/delay?timeout={DELAY_TEST_TIMEOUT_MS}&url={}",
        encode_component(&node_name),
        encode_component(&test_url),
    );

    match client
        .get_json_with_timeout(&path, DELAY_REQUEST_TIMEOUT)
        .await
    {
        Ok(value) => {
            let latency = value
                .get("delay")
                .and_then(Value::as_u64)
                .or_else(|| value.get("latency").and_then(Value::as_u64))
                .unwrap_or(0) as u32;
            DelayResult {
                latency,
                available: latency > 0,
                message: None,
            }
        }
        Err(error) => DelayResult {
            latency: 0,
            available: false,
            message: Some(error),
        },
    }
}

fn format_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "请求 Mihomo 控制器超时".into()
    } else if error.is_connect() {
        format!("无法连接 Mihomo 控制器：{error}")
    } else {
        error.to_string()
    }
}

fn controller_base_url(settings: &SettingsMap) -> Option<String> {
    let raw = settings
        .get("externalController")
        .and_then(value_to_string)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| settings.get("controllerPort").and_then(value_to_string))?;
    let value = raw.trim().trim_end_matches('/').to_string();

    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(value);
    }

    if value.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(format!("http://127.0.0.1:{value}"));
    }

    Some(format!("http://{value}"))
}

fn disconnected_runtime(message: &str, controller_url: &str) -> RuntimeInfo {
    RuntimeInfo {
        controller_connected: false,
        controller_url: controller_url.to_string(),
        core_version: "未连接".into(),
        upload_total: "0 B".into(),
        download_total: "0 B".into(),
        last_sync: current_time(),
        tun_enabled: false,
        process_mode: "未连接".into(),
        error: Some(message.into()),
    }
}

fn apply_proxies(snapshot: &mut AppSnapshot, value: &Value) -> Vec<(String, String)> {
    let Some(proxies) = value.get("proxies").and_then(Value::as_object) else {
        return Vec::new();
    };

    let local_groups_by_name = snapshot
        .groups
        .iter()
        .filter(|group| group.origin == "local")
        .map(|group| (group.name.clone(), group.clone()))
        .collect::<HashMap<_, _>>();
    let previous_nodes_by_name = snapshot
        .nodes
        .iter()
        .map(|node| (node.name.clone(), node.clone()))
        .collect::<HashMap<_, _>>();
    let previous_selection = snapshot
        .groups
        .iter()
        .filter_map(|group| {
            group
                .current_node_id
                .as_ref()
                .map(|current| (group.id.clone(), current.clone()))
        })
        .collect::<HashMap<_, _>>();
    let name_to_group_id = proxies
        .iter()
        .filter(|(name, proxy)| is_group_proxy(name, proxy))
        .map(|(name, _)| {
            let id = local_groups_by_name
                .get(name)
                .map(|group| group.id.clone())
                .unwrap_or_else(|| stable_id("group", name));
            (name.clone(), id)
        })
        .collect::<HashMap<_, _>>();
    let mut name_to_node_id = HashMap::new();
    let mut managed_nodes = Vec::new();

    for (name, proxy) in proxies {
        if is_group_proxy(name, proxy) || is_builtin_special_proxy(proxy) {
            continue;
        }

        let id = stable_id("node", name);
        let previous = previous_nodes_by_name.get(name);
        name_to_node_id.insert(name.clone(), id.clone());
        managed_nodes.push(ProxyNode {
            id,
            name: name.clone(),
            country: previous.and_then(|node| node.country.clone()),
            flag: previous.and_then(|node| node.flag.clone()),
            protocol: proxy_string(proxy, "type").unwrap_or_else(|| "Unknown".into()),
            address: proxy_string(proxy, "server")
                .filter(|value| !value.trim().is_empty())
                .or_else(|| previous.map(|node| node.address.clone()))
                .unwrap_or_default(),
            port: proxy_u64(proxy, "port")
                .and_then(|value| u16::try_from(value).ok())
                .filter(|value| *value > 0)
                .or_else(|| previous.map(|node| node.port))
                .unwrap_or(0),
            latency: last_delay(proxy),
            password: None,
            cipher: proxy_string(proxy, "cipher")
                .or_else(|| previous.and_then(|node| node.cipher.clone())),
            dialer_proxy: proxy_string(proxy, "dialer-proxy")
                .or_else(|| proxy_string(proxy, "dialerProxy"))
                .or_else(|| previous.and_then(|node| node.dialer_proxy.clone())),
            group: proxy_string(proxy, "provider")
                .or_else(|| previous.and_then(|node| node.group.clone())),
            origin: MANAGED_ORIGIN.into(),
            available: last_delay(proxy) > 0 || !proxy_has_failed_history(proxy),
        });
    }

    let mut runtime_groups = Vec::new();
    let mut runtime_group_names = HashSet::new();
    let mut selection_corrections = Vec::new();
    for (name, proxy) in proxies {
        if !is_group_proxy(name, proxy) {
            continue;
        }

        let all_names = proxy
            .get("all")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let node_ids = all_names
            .iter()
            .filter_map(|node_name| name_to_node_id.get(node_name).cloned())
            .collect::<Vec<_>>();
        let group_id = name_to_group_id
            .get(name)
            .cloned()
            .unwrap_or_else(|| stable_id("group", name));
        let group_ids = all_names
            .iter()
            .filter_map(|group_name| name_to_group_id.get(group_name).cloned())
            .filter(|member_id| member_id != &group_id)
            .collect::<Vec<_>>();
        let current_node_id = previous_selection
            .get(&group_id)
            .filter(|member_id| node_ids.contains(member_id) || group_ids.contains(member_id))
            .cloned()
            .or_else(|| node_ids.first().cloned())
            .or_else(|| group_ids.first().cloned());
        let runtime_current_id = proxy_string(proxy, "now").and_then(|current_name| {
            name_to_node_id
                .get(&current_name)
                .or_else(|| name_to_group_id.get(&current_name))
                .cloned()
        });
        let group_type = map_group_type(&proxy_string(proxy, "type").unwrap_or_default(), name);
        let allow_manual =
            group_type != "URL-Test" && group_type != "Direct" && group_type != "Block";
        if allow_manual && current_node_id != runtime_current_id {
            if let Some(target_name) = current_node_id.as_ref().and_then(|target_id| {
                all_names.iter().find(|member_name| {
                    name_to_node_id.get(*member_name) == Some(target_id)
                        || name_to_group_id.get(*member_name) == Some(target_id)
                })
            }) {
                selection_corrections.push((name.clone(), target_name.clone()));
            }
        }

        runtime_group_names.insert(name.clone());
        let mut runtime_group = local_groups_by_name
            .get(name)
            .cloned()
            .unwrap_or(ProxyGroup {
                id: group_id.clone(),
                name: name.clone(),
                group_type: group_type.clone(),
                origin: MANAGED_ORIGIN.into(),
                icon: group_icon(&group_type).into(),
                description: "来自 Mihomo 外部控制器".into(),
                node_ids: Vec::new(),
                group_ids: Vec::new(),
                current_node_id: None,
                auto_test: group_type == "URL-Test" || group_type == "Fallback",
                allow_manual,
            });
        runtime_group.id = group_id;
        runtime_group.group_type = group_type;
        runtime_group.node_ids = node_ids;
        runtime_group.group_ids = group_ids;
        runtime_group.current_node_id = current_node_id;
        runtime_group.allow_manual = allow_manual;
        runtime_groups.push(runtime_group);
    }

    snapshot.nodes.retain(|node| node.origin != MANAGED_ORIGIN);
    snapshot.groups.retain(|group| {
        group.origin != MANAGED_ORIGIN && !runtime_group_names.contains(&group.name)
    });
    snapshot.nodes.extend(managed_nodes);
    snapshot.groups.extend(runtime_groups);
    selection_corrections
}

fn apply_connections(snapshot: &mut AppSnapshot, runtime: &mut RuntimeInfo, value: &Value) {
    let (upload_total, download_total) = connection_totals(value);
    runtime.upload_total = format_bytes(upload_total);
    runtime.download_total = format_bytes(download_total);

    snapshot.connections = parse_connections(value, &snapshot.nodes);

    let now = Local::now();
    let sampled_at = now.timestamp_millis();
    let mut point = TrafficPoint {
        time: now.format("%H:%M").to_string(),
        sampled_at,
        download: bytes_to_megabytes(download_total),
        upload: bytes_to_megabytes(upload_total),
        proxy_groups: HashMap::new(),
    };

    for group in snapshot
        .groups
        .iter()
        .filter(|group| group.origin == MANAGED_ORIGIN)
    {
        let total = snapshot
            .connections
            .iter()
            .filter(|connection| connection.policy == group.name)
            .count() as f64;
        point
            .proxy_groups
            .insert(format!("proxyGroupTraffic_{}", group.id), total);
    }

    snapshot.traffic_history.retain(|item| {
        item.sampled_at == 0 || item.sampled_at >= sampled_at - TRAFFIC_HISTORY_RETENTION_MS
    });
    if snapshot.traffic_history.last().is_some_and(|item| {
        item.sampled_at > 0
            && item.sampled_at / TRAFFIC_HISTORY_BUCKET_MS == sampled_at / TRAFFIC_HISTORY_BUCKET_MS
    }) {
        if let Some(last) = snapshot.traffic_history.last_mut() {
            *last = point;
        }
    } else {
        snapshot.traffic_history.push(point);
    }
}

fn connection_totals(value: &Value) -> (u64, u64) {
    let upload_total = value
        .get("uploadTotal")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let download_total = value
        .get("downloadTotal")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    (upload_total, download_total)
}

fn parse_connections(value: &Value, nodes: &[ProxyNode]) -> Vec<Connection> {
    let mut connections = value
        .get("connections")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(map_connection).collect::<Vec<_>>())
        .unwrap_or_default();
    for connection in &mut connections {
        enrich_connection_route(connection, nodes);
    }
    connections
}

fn apply_rules(snapshot: &mut AppSnapshot, value: &Value) {
    let Some(rules) = value.get("rules").and_then(Value::as_array) else {
        return;
    };

    let local_rule_keys = snapshot
        .rules
        .iter()
        .filter(|rule| rule.source == "local")
        .map(|rule| (rule.rule_type.clone(), rule.content.clone()))
        .collect::<HashSet<_>>();
    let managed_rules = rules
        .iter()
        .enumerate()
        .filter_map(|(index, rule)| {
            let raw_type = proxy_string(rule, "type").unwrap_or_else(|| "MATCH".into());
            let content = proxy_string(rule, "payload")
                .or_else(|| proxy_string(rule, "rule"))
                .or_else(|| proxy_string(rule, "name"))
                .unwrap_or_else(|| "MATCH".into());
            let mut policy = proxy_string(rule, "proxy")
                .or_else(|| proxy_string(rule, "adapter"))
                .unwrap_or_else(|| "DIRECT".into());
            let rule_type = map_rule_type(&raw_type);
            if local_rule_keys.contains(&(rule_type.clone(), content.clone())) {
                return None;
            }
            let rule_override = snapshot
                .rule_overrides
                .iter()
                .find(|item| item.target_rule_type == rule_type && item.target_content == content);
            if rule_override.is_some_and(|item| !item.enabled) {
                return None;
            }
            if let Some(item) = rule_override {
                policy = item.policy.clone();
            }
            Some(RoutingRule {
                id: stable_id("rule", &format!("{index}:{raw_type}:{content}:{policy}")),
                rule_type,
                content,
                policy,
                source: MANAGED_ORIGIN.into(),
                enabled: true,
                no_resolve: rule_override
                    .map(|item| item.no_resolve)
                    .unwrap_or_else(|| proxy_bool(rule, "noResolve").unwrap_or(false)),
                wildcard: false,
                note: rule_override
                    .and_then(|item| item.note.clone())
                    .or_else(|| Some("来自 Mihomo 控制器".into())),
            })
        })
        .collect::<Vec<_>>();

    snapshot.rules.retain(|rule| rule.source != MANAGED_ORIGIN);
    snapshot.rules.extend(managed_rules);
}

fn normalize_selection(snapshot: &mut AppSnapshot) {
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
            .groups
            .iter()
            .find(|group| group.id == snapshot.selected_group_id)
            .and_then(|group| group.current_node_id.clone())
            .filter(|current_id| snapshot.nodes.iter().any(|node| node.id == *current_id))
            .or_else(|| snapshot.nodes.first().map(|node| node.id.clone()))
            .unwrap_or_default();
    }
}

fn map_connection(value: &Value) -> Connection {
    let metadata = value.get("metadata").unwrap_or(&Value::Null);
    let id = proxy_string(value, "id").unwrap_or_else(|| stable_id("conn", &value.to_string()));
    let host = proxy_string(metadata, "host").unwrap_or_default();
    let destination_ip = proxy_string(metadata, "destinationIP")
        .or_else(|| proxy_string(metadata, "destinationIp"))
        .unwrap_or_default();
    let port = proxy_u64(metadata, "destinationPort").unwrap_or(0);
    let target_host = if host.is_empty() {
        destination_ip.clone()
    } else {
        host
    };
    let raw_process = proxy_string(metadata, "process").filter(|value| !value.trim().is_empty());
    let process_path = proxy_string(metadata, "processPath")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            raw_process
                .as_ref()
                .filter(|value| value.contains(['/', '\\']))
                .cloned()
        })
        .unwrap_or_default();
    let process = raw_process
        .as_deref()
        .or_else(|| (!process_path.is_empty()).then_some(process_path.as_str()))
        .unwrap_or("内核未识别")
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("内核未识别")
        .to_string();
    let app = process.clone();
    let icon = application_icon_data_url(&process_path).unwrap_or_default();
    let chains = value
        .get("chains")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let chain = chains.into_iter().rev().collect::<Vec<_>>();
    let policy = chain.first().cloned().unwrap_or_else(|| "DIRECT".into());
    let node = chain.last().cloned().unwrap_or_else(|| policy.clone());

    let upload_bytes = proxy_u64(value, "upload").unwrap_or(0);
    let download_bytes = proxy_u64(value, "download").unwrap_or(0);

    Connection {
        id,
        app,
        process,
        process_path,
        icon,
        target: if port > 0 {
            format!("{target_host}:{port}")
        } else {
            target_host
        },
        ip: destination_ip,
        protocol: proxy_string(metadata, "network")
            .unwrap_or_else(|| "TCP".into())
            .to_uppercase(),
        upload_bytes,
        download_bytes,
        upload: format_bytes(upload_bytes),
        download: format_bytes(download_bytes),
        duration: format_duration(proxy_string(value, "start").as_deref()),
        rule: proxy_string(value, "rule").unwrap_or_else(|| "MATCH".into()),
        policy,
        node,
        entry_node: String::new(),
        chain,
        status: "活跃".into(),
    }
}

fn enrich_connection_route(connection: &mut Connection, nodes: &[ProxyNode]) {
    let route_nodes = connection
        .chain
        .iter()
        .filter_map(|name| nodes.iter().find(|node| node.name == *name))
        .collect::<Vec<_>>();
    let internal_target_node = (connection.process == "内核未识别" && connection.chain.len() >= 2)
        .then(|| {
            nodes.iter().find(|node| {
                node.dialer_proxy
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                    && connection_targets_node(connection, node)
            })
        })
        .flatten();

    if let Some(exit_node) = internal_target_node.or_else(|| route_nodes.first().copied()) {
        connection.node = exit_node.name.clone();
    }
    connection.entry_node = route_nodes
        .last()
        .filter(|entry_node| entry_node.name != connection.node)
        .map(|entry_node| entry_node.name.clone())
        .unwrap_or_default();

    if let Some(node) = internal_target_node {
        connection.app = "Mihomo 内部连接".into();
        connection.process = format!(
            "前置代理：{}",
            node.dialer_proxy.as_deref().unwrap_or("未知")
        );
    }
}

fn connection_targets_node(connection: &Connection, node: &ProxyNode) -> bool {
    if node.port == 0 || node.address.trim().is_empty() {
        return false;
    }

    let port_suffix = format!(":{}", node.port);
    let Some(host) = connection.target.strip_suffix(&port_suffix) else {
        return false;
    };
    normalize_connection_host(host).eq_ignore_ascii_case(normalize_connection_host(&node.address))
        || normalize_connection_host(&connection.ip)
            .eq_ignore_ascii_case(normalize_connection_host(&node.address))
}

fn normalize_connection_host(value: &str) -> &str {
    value.trim().trim_start_matches('[').trim_end_matches(']')
}

pub(crate) fn push_runtime_log(
    snapshot: &mut AppSnapshot,
    level: &str,
    source: &str,
    content: &str,
) {
    snapshot.logs.insert(
        0,
        LogEntry {
            id: stable_id(
                "log",
                &format!(
                    "{}:{level}:{source}:{content}",
                    Utc::now().timestamp_millis()
                ),
            ),
            time: current_time(),
            level: level.into(),
            source: source.into(),
            content: content.into(),
        },
    );

    if snapshot.logs.len() > 1000 {
        snapshot.logs.truncate(1000);
    }
}

fn is_group_proxy(name: &str, proxy: &Value) -> bool {
    if proxy.get("all").and_then(Value::as_array).is_some() {
        return true;
    }

    let proxy_type = proxy_string(proxy, "type")
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        proxy_type.as_str(),
        "selector" | "urltest" | "url-test" | "fallback" | "loadbalance" | "load-balance" | "relay"
    ) || matches!(name, "DIRECT" | "REJECT" | "GLOBAL")
}

fn is_builtin_special_proxy(proxy: &Value) -> bool {
    let proxy_type = proxy_string(proxy, "type")
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        proxy_type.as_str(),
        "compatible" | "pass" | "passrule" | "rejectdrop"
    )
}

fn proxy_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(value_to_string)
        .filter(|value| !value.trim().is_empty())
}

fn proxy_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
    })
}

fn proxy_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn last_delay(proxy: &Value) -> u32 {
    proxy
        .get("history")
        .and_then(Value::as_array)
        .and_then(|history| history.last())
        .and_then(|item| item.get("delay"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32
}

fn proxy_has_failed_history(proxy: &Value) -> bool {
    proxy
        .get("history")
        .and_then(Value::as_array)
        .and_then(|history| history.last())
        .and_then(|item| item.get("delay"))
        .and_then(Value::as_i64)
        .is_some_and(|delay| delay <= 0)
}

fn map_group_type(proxy_type: &str, name: &str) -> String {
    if name == "DIRECT" {
        return "Direct".into();
    }
    if name == "REJECT" {
        return "Block".into();
    }

    match proxy_type.to_lowercase().as_str() {
        "fallback" => "Fallback",
        "urltest" | "url-test" => "URL-Test",
        "loadbalance" | "load-balance" => "Load-Balance",
        "direct" => "Direct",
        "reject" => "Block",
        _ => "Selector",
    }
    .into()
}

fn group_icon(group_type: &str) -> &'static str {
    match group_type {
        "URL-Test" => "⚡",
        "Fallback" => "🛡️",
        "Load-Balance" => "⇄",
        "Direct" => "↗",
        "Block" => "⊘",
        _ => "🌐",
    }
}

fn map_rule_type(rule_type: &str) -> String {
    match rule_type.to_lowercase().replace('_', "-").as_str() {
        "domainsuffix" | "domain-suffix" => "DOMAIN-SUFFIX",
        "domainkeyword" | "domain-keyword" => "DOMAIN-KEYWORD",
        "domain" => "DOMAIN",
        "ipcidr" | "ip-cidr" | "ip-cidr6" => "IP-CIDR",
        "ruleset" | "rule-set" => "RULE-SET",
        "geoip" => "GEOIP",
        "processname" | "process-name" => "PROCESS-NAME",
        "processpath" | "process-path" => "PROCESS-PATH",
        _ => "MATCH",
    }
    .into()
}

fn stable_id(prefix: &str, value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{prefix}-{hash:x}")
}

const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

fn encode_component(value: &str) -> String {
    utf8_percent_encode(value, URI_COMPONENT).to_string()
}

fn format_bytes(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit_index = 0;

    while value >= 1024.0 && unit_index < units.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{bytes} B")
    } else if value >= 100.0 {
        format!("{value:.0} {}", units[unit_index])
    } else if value >= 10.0 {
        format!("{value:.1} {}", units[unit_index])
    } else {
        format!("{value:.2} {}", units[unit_index])
    }
}

fn bytes_to_megabytes(bytes: u64) -> f64 {
    bytes as f64 / 1024.0 / 1024.0
}

fn format_duration(start: Option<&str>) -> String {
    let Some(start) = start else {
        return "实时".into();
    };
    let Ok(started_at) = DateTime::parse_from_rfc3339(start) else {
        return "实时".into();
    };
    let elapsed = Utc::now().signed_duration_since(started_at.with_timezone(&Utc));
    let seconds = elapsed.num_seconds().max(0);
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::default_snapshot;

    fn test_node(name: &str, address: &str, port: u16, dialer_proxy: Option<&str>) -> ProxyNode {
        ProxyNode {
            id: stable_id("node", name),
            name: name.into(),
            country: None,
            flag: None,
            protocol: "ss".into(),
            address: address.into(),
            port,
            latency: 0,
            password: None,
            cipher: None,
            dialer_proxy: dialer_proxy.map(str::to_string),
            group: None,
            origin: MANAGED_ORIGIN.into(),
            available: true,
        }
    }

    #[test]
    fn maps_process_rule_types_from_mihomo() {
        assert_eq!(map_rule_type("ProcessName"), "PROCESS-NAME");
        assert_eq!(map_rule_type("PROCESS-PATH"), "PROCESS-PATH");
    }

    #[test]
    fn maps_process_name_and_path_without_reusing_the_path_as_the_name() {
        let connection = map_connection(&json!({
            "id": "connection-1",
            "metadata": {
                "process": "language_server_windows_x64.exe",
                "processPath": "Z:\\missing\\language_server_windows_x64.exe",
                "host": "example.com",
                "destinationPort": 443,
                "network": "tcp"
            },
            "upload": 2048,
            "download": 4096
        }));

        assert_eq!(connection.app, "language_server_windows_x64.exe");
        assert_eq!(connection.process, "language_server_windows_x64.exe");
        assert_eq!(
            connection.process_path,
            "Z:\\missing\\language_server_windows_x64.exe"
        );
        assert!(connection.icon.is_empty());
        assert_eq!(connection.upload_bytes, 2048);
        assert_eq!(connection.download_bytes, 4096);
        assert_eq!(connection.upload, "2.00 KB");
        assert_eq!(connection.download, "4.00 KB");
    }

    #[test]
    fn marks_a_connection_unrecognized_only_when_process_metadata_is_missing() {
        let connection = map_connection(&json!({
            "id": "connection-2",
            "metadata": {
                "destinationIP": "203.0.113.1",
                "destinationPort": 443
            }
        }));

        assert_eq!(connection.app, "内核未识别");
        assert_eq!(connection.process, "内核未识别");
        assert!(connection.process_path.is_empty());
        assert!(connection.icon.is_empty());
    }

    #[test]
    fn classifies_dialer_proxy_transport_and_separates_exit_from_physical_entry() {
        let nodes = vec![
            test_node("美国出口", "vircs.wellux.top", 38898, Some("香港前置组")),
            test_node("香港B", "hk.example.com", 443, None),
        ];
        let mut connection = map_connection(&json!({
            "id": "connection-3",
            "metadata": {
                "host": "vircs.wellux.top",
                "destinationIP": "203.0.113.2",
                "destinationPort": 38898,
                "network": "tcp"
            },
            "chains": ["香港B", "美国出口", "美国ATT家宽"]
        }));

        enrich_connection_route(&mut connection, &nodes);

        assert_eq!(connection.app, "Mihomo 内部连接");
        assert_eq!(connection.process, "前置代理：香港前置组");
        assert_eq!(connection.node, "美国出口");
        assert_eq!(connection.entry_node, "香港B");
    }

    #[test]
    fn keeps_application_identity_while_correcting_a_chained_connections_exit() {
        let nodes = vec![
            test_node("美国出口", "us.example.com", 443, Some("香港前置组")),
            test_node("香港B", "hk.example.com", 443, None),
        ];
        let mut connection = map_connection(&json!({
            "id": "connection-4",
            "metadata": {
                "process": "chrome.exe",
                "host": "www.example.com",
                "destinationPort": 443
            },
            "chains": ["香港B", "美国出口", "美国ATT家宽"]
        }));

        enrich_connection_route(&mut connection, &nodes);

        assert_eq!(connection.app, "chrome.exe");
        assert_eq!(connection.node, "美国出口");
        assert_eq!(connection.entry_node, "香港B");
    }

    #[test]
    fn excludes_builtin_special_proxies_from_nodes() {
        let mut snapshot = default_snapshot();
        let proxies = json!({
            "proxies": {
                "COMPATIBLE": { "type": "Compatible" },
                "PASS": { "type": "Pass" },
                "PASS-RULE": { "type": "PassRule" },
                "REJECT-DROP": { "type": "RejectDrop" },
                "正常节点": {
                    "type": "ss",
                    "server": "example.com",
                    "port": 443
                }
            }
        });

        apply_proxies(&mut snapshot, &proxies);

        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.nodes[0].name, "正常节点");
    }

    #[test]
    fn preserves_config_only_node_fields_when_runtime_proxy_data_is_incomplete() {
        let mut snapshot = default_snapshot();
        snapshot.nodes.push(test_node(
            "AT&T尔湾",
            "vircs.wellux.top",
            38898,
            Some("美国ATT家宽"),
        ));
        let proxies = json!({
            "proxies": {
                "AT&T尔湾": {
                    "type": "ss",
                    "history": []
                }
            }
        });

        apply_proxies(&mut snapshot, &proxies);

        let node = snapshot
            .nodes
            .iter()
            .find(|node| node.name == "AT&T尔湾")
            .expect("运行节点应被保留");
        assert_eq!(node.address, "vircs.wellux.top");
        assert_eq!(node.port, 38898);
        assert_eq!(node.dialer_proxy.as_deref(), Some("美国ATT家宽"));
    }

    #[test]
    fn preserves_local_group_identity_when_it_appears_in_runtime_proxies() {
        let mut snapshot = default_snapshot();
        snapshot.groups.push(ProxyGroup {
            id: "local-custom".into(),
            name: "手动前置".into(),
            group_type: "Selector".into(),
            origin: "local".into(),
            icon: "local-icon".into(),
            description: "本地配置".into(),
            node_ids: vec!["old-node".into()],
            group_ids: Vec::new(),
            current_node_id: None,
            auto_test: false,
            allow_manual: true,
        });
        let proxies = json!({
            "proxies": {
                "香港节点": { "type": "ss", "server": "hk.example.com", "port": 443 },
                "手动前置": { "type": "Selector", "all": ["香港节点"], "now": "香港节点" },
                "AI": { "type": "Selector", "all": ["手动前置"], "now": "手动前置" }
            }
        });

        apply_proxies(&mut snapshot, &proxies);

        let local_group = snapshot
            .groups
            .iter()
            .find(|group| group.name == "手动前置")
            .expect("应保留本地代理组");
        assert_eq!(local_group.id, "local-custom");
        assert_eq!(local_group.origin, "local");
        assert_eq!(local_group.icon, "local-icon");
        assert_eq!(
            snapshot
                .groups
                .iter()
                .find(|group| group.name == "AI")
                .expect("应保留托管组")
                .group_ids,
            vec!["local-custom"]
        );
    }

    #[test]
    fn maps_nested_proxy_groups_and_defaults_to_first_node() {
        let mut snapshot = default_snapshot();
        let proxies = json!({
            "proxies": {
                "香港节点": { "type": "ss", "server": "hk.example.com", "port": 443 },
                "美国节点": { "type": "ss", "server": "us.example.com", "port": 443 },
                "地区组": { "type": "Selector", "all": ["香港节点"] },
                "总选择": { "type": "Selector", "all": ["地区组", "美国节点"], "now": "地区组" }
            }
        });

        let corrections = apply_proxies(&mut snapshot, &proxies);

        let parent = snapshot
            .groups
            .iter()
            .find(|group| group.name == "总选择")
            .expect("应生成总选择代理组");
        assert_eq!(parent.group_ids, vec![stable_id("group", "地区组")]);
        assert_eq!(
            parent.current_node_id.as_deref(),
            Some(stable_id("node", "美国节点").as_str())
        );
        assert!(corrections.contains(&("总选择".into(), "美国节点".into())));
    }

    #[test]
    fn preserves_existing_proxy_selection_across_subscription_refreshes() {
        let mut snapshot = default_snapshot();
        let initial = json!({
            "proxies": {
                "香港节点": { "type": "ss", "server": "hk.example.com", "port": 443 },
                "美国节点": { "type": "ss", "server": "us.example.com", "port": 443 },
                "手动选择": { "type": "Selector", "all": ["香港节点", "美国节点"], "now": "香港节点" }
            }
        });
        apply_proxies(&mut snapshot, &initial);
        let group_id = stable_id("group", "手动选择");
        let us_node_id = stable_id("node", "美国节点");
        snapshot
            .groups
            .iter_mut()
            .find(|group| group.id == group_id)
            .expect("应生成手动选择代理组")
            .current_node_id = Some(us_node_id.clone());

        let corrections = apply_proxies(&mut snapshot, &initial);

        let group = snapshot
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .expect("刷新后应保留代理组");
        assert_eq!(group.current_node_id.as_deref(), Some(us_node_id.as_str()));
        assert_eq!(corrections, vec![("手动选择".into(), "美国节点".into())]);

        let without_us = json!({
            "proxies": {
                "香港节点": { "type": "ss", "server": "hk.example.com", "port": 443 },
                "手动选择": { "type": "Selector", "all": ["香港节点"] }
            }
        });
        apply_proxies(&mut snapshot, &without_us);
        let group = snapshot
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .expect("更新后应保留代理组");
        assert_eq!(
            group.current_node_id.as_deref(),
            Some(stable_id("node", "香港节点").as_str())
        );
    }

    #[test]
    fn closes_newest_connections_over_global_limit() {
        let value = json!({
            "connections": [
                { "id": "oldest", "start": "2026-01-01T00:00:00Z" },
                { "id": "newest", "start": "2026-01-01T00:02:00Z" },
                { "id": "middle", "start": "2026-01-01T00:01:00Z" }
            ]
        });

        assert_eq!(overflow_connection_ids(&value, 2), vec!["newest"]);
        assert!(overflow_connection_ids(&value, 0).len() == 3);
    }
}
