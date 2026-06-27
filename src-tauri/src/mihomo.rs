use std::{collections::HashMap, time::Duration};

use chrono::{DateTime, Local, Utc};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{header::AUTHORIZATION, Client};
use serde_json::{json, Value};

use crate::{
    defaults::{current_time, value_to_string},
    models::{
        AppSnapshot, Connection, DelayResult, LogEntry, ProxyGroup, ProxyNode, RoutingRule,
        RuntimeInfo, SettingsMap, TrafficPoint,
    },
};

const MANAGED_ORIGIN: &str = "managed";
const DEFAULT_TEST_URL: &str = "https://www.gstatic.com/generate_204";

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
        let response = self
            .with_auth(self.client.get(self.url(path)))
            .send()
            .await
            .map_err(|error| error.to_string())?;

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

    pub async fn reload_config(&self, payload: &str) -> Result<(), String> {
        self.put_json(
            "/configs?force=true",
            json!({ "path": "", "payload": payload }),
        )
        .await
        .map(|_| ())
    }

    pub async fn verify_runtime_proxies(&self) -> Result<(), String> {
        self.get_json("/proxies").await.map(|_| ())
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

    match client.get_json("/proxies").await {
        Ok(proxies) => apply_proxies(&mut snapshot, &proxies),
        Err(error) => errors.push(format!("代理读取失败：{error}")),
    }

    match client.get_json("/connections").await {
        Ok(connections) => apply_connections(&mut snapshot, &mut runtime, &connections),
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

pub async fn select_proxy_node(
    mut snapshot: AppSnapshot,
    group_name: String,
    node_name: String,
) -> Result<AppSnapshot, String> {
    let client = MihomoClient::from_settings(&snapshot.settings)
        .ok_or_else(|| "未配置 Mihomo 外部控制器地址".to_string())?;
    let path = format!("/proxies/{}", encode_component(&group_name));
    client.put_json(&path, json!({ "name": node_name })).await?;
    push_runtime_log(
        &mut snapshot,
        "SUCCESS",
        "代理",
        &format!("已通过 Mihomo 控制器切换“{group_name}”至“{node_name}”"),
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
        "/proxies/{}/delay?timeout=5000&url={}",
        encode_component(&node_name),
        encode_component(&test_url),
    );

    match client.get_json(&path).await {
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
        error: Some(message.into()),
    }
}

fn apply_proxies(snapshot: &mut AppSnapshot, value: &Value) {
    let Some(proxies) = value.get("proxies").and_then(Value::as_object) else {
        return;
    };

    let mut name_to_node_id = HashMap::new();
    let mut managed_nodes = Vec::new();

    for (name, proxy) in proxies {
        if is_group_proxy(name, proxy) || is_builtin_special_proxy(proxy) {
            continue;
        }

        let id = stable_id("node", name);
        name_to_node_id.insert(name.clone(), id.clone());
        managed_nodes.push(ProxyNode {
            id,
            name: name.clone(),
            country: None,
            flag: None,
            protocol: proxy_string(proxy, "type").unwrap_or_else(|| "Unknown".into()),
            address: proxy_string(proxy, "server").unwrap_or_default(),
            port: proxy_u64(proxy, "port").unwrap_or(0) as u16,
            latency: last_delay(proxy),
            password: None,
            cipher: proxy_string(proxy, "cipher"),
            dialer_proxy: proxy_string(proxy, "dialer-proxy")
                .or_else(|| proxy_string(proxy, "dialerProxy")),
            group: proxy_string(proxy, "provider"),
            origin: MANAGED_ORIGIN.into(),
            available: last_delay(proxy) > 0 || !proxy_has_failed_history(proxy),
        });
    }

    let mut managed_groups = Vec::new();
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
        let current_node_id =
            proxy_string(proxy, "now").and_then(|now| name_to_node_id.get(&now).cloned());
        let group_type = map_group_type(&proxy_string(proxy, "type").unwrap_or_default(), name);

        managed_groups.push(ProxyGroup {
            id: stable_id("group", name),
            name: name.clone(),
            group_type: group_type.clone(),
            origin: MANAGED_ORIGIN.into(),
            icon: group_icon(&group_type).into(),
            description: "来自 Mihomo 外部控制器".into(),
            node_ids,
            current_node_id,
            auto_test: group_type == "URL-Test" || group_type == "Fallback",
            allow_manual: group_type != "URL-Test"
                && group_type != "Direct"
                && group_type != "Block",
        });
    }

    snapshot.nodes.retain(|node| node.origin != MANAGED_ORIGIN);
    snapshot
        .groups
        .retain(|group| group.origin != MANAGED_ORIGIN);
    snapshot.nodes.extend(managed_nodes);
    snapshot.groups.extend(managed_groups);
}

fn apply_connections(snapshot: &mut AppSnapshot, runtime: &mut RuntimeInfo, value: &Value) {
    let upload_total = value
        .get("uploadTotal")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let download_total = value
        .get("downloadTotal")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    runtime.upload_total = format_bytes(upload_total);
    runtime.download_total = format_bytes(download_total);

    let connections = value
        .get("connections")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(map_connection).collect::<Vec<_>>())
        .unwrap_or_default();
    snapshot.connections = connections;

    let mut point = TrafficPoint {
        time: Local::now().format("%H:%M").to_string(),
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

    snapshot.traffic_history.push(point);
    if snapshot.traffic_history.len() > 60 {
        let overflow = snapshot.traffic_history.len() - 60;
        snapshot.traffic_history.drain(0..overflow);
    }
}

fn apply_rules(snapshot: &mut AppSnapshot, value: &Value) {
    let Some(rules) = value.get("rules").and_then(Value::as_array) else {
        return;
    };

    let managed_rules = rules
        .iter()
        .enumerate()
        .map(|(index, rule)| {
            let raw_type = proxy_string(rule, "type").unwrap_or_else(|| "MATCH".into());
            let content = proxy_string(rule, "payload")
                .or_else(|| proxy_string(rule, "rule"))
                .or_else(|| proxy_string(rule, "name"))
                .unwrap_or_else(|| "MATCH".into());
            let policy = proxy_string(rule, "proxy")
                .or_else(|| proxy_string(rule, "adapter"))
                .unwrap_or_else(|| "DIRECT".into());
            RoutingRule {
                id: stable_id("rule", &format!("{index}:{raw_type}:{content}:{policy}")),
                rule_type: map_rule_type(&raw_type),
                content,
                policy,
                source: MANAGED_ORIGIN.into(),
                enabled: true,
                no_resolve: proxy_bool(rule, "noResolve").unwrap_or(false),
                wildcard: false,
                note: Some("来自 Mihomo 控制器".into()),
            }
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
    let process = proxy_string(metadata, "process")
        .or_else(|| proxy_string(metadata, "processPath"))
        .unwrap_or_else(|| "未知进程".into());
    let app = process
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(&process)
        .to_string();
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

    Connection {
        id,
        app,
        process,
        icon: "◆".into(),
        target: if port > 0 {
            format!("{target_host}:{port}")
        } else {
            target_host
        },
        ip: destination_ip,
        protocol: proxy_string(metadata, "network")
            .unwrap_or_else(|| "TCP".into())
            .to_uppercase(),
        upload: format_bytes(proxy_u64(value, "upload").unwrap_or(0)),
        download: format_bytes(proxy_u64(value, "download").unwrap_or(0)),
        duration: format_duration(proxy_string(value, "start").as_deref()),
        rule: proxy_string(value, "rule").unwrap_or_else(|| "MATCH".into()),
        policy: chains.first().cloned().unwrap_or_else(|| "DIRECT".into()),
        status: "活跃".into(),
    }
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

fn encode_component(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
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
}
