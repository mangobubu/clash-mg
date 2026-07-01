use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type SettingsMap = HashMap<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyNode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flag: Option<String>,
    pub protocol: String,
    pub address: String,
    pub port: u16,
    pub latency: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cipher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialer_proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub origin: String,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyGroup {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub group_type: String,
    pub origin: String,
    pub icon: String,
    pub description: String,
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub group_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_node_id: Option<String>,
    pub auto_test: bool,
    pub allow_manual: bool,
    #[serde(default = "default_proxy_group_test_url")]
    pub test_url: String,
    #[serde(default = "default_proxy_group_interval")]
    pub interval: u32,
    #[serde(default = "default_proxy_group_tolerance")]
    pub tolerance: u32,
    #[serde(default = "default_load_balance_strategy")]
    pub load_balance_strategy: String,
    #[serde(default = "default_true")]
    pub health_check: bool,
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: u32,
    #[serde(default)]
    pub extra: String,
}

fn default_proxy_group_test_url() -> String {
    "https://www.gstatic.com/generate_204".into()
}

fn default_proxy_group_interval() -> u32 {
    300
}

fn default_proxy_group_tolerance() -> u32 {
    50
}

fn default_load_balance_strategy() -> String {
    "round-robin".into()
}

fn default_true() -> bool {
    true
}

fn default_failure_threshold() -> u32 {
    3
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyGroupMemberOverride {
    pub target_group_id: String,
    pub target_group_name: String,
    pub added_group_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyNodeDialerOverride {
    pub target_node_id: String,
    pub target_node_name: String,
    pub dialer_proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub subscription_type: String,
    pub url: String,
    pub node_count: usize,
    pub last_updated: String,
    pub update_interval: u32,
    pub status: String,
    pub enabled: bool,
    pub auto_update: bool,
    pub proxy_update: bool,
    pub allow_override: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub health_check: bool,
    #[serde(default = "default_proxy_group_test_url")]
    pub test_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub used_traffic: String,
    pub expires_at: String,
    pub tags: Vec<String>,
}

impl Subscription {
    pub fn is_runtime_provider_record(&self) -> bool {
        self.description.as_deref() == Some("来自 Mihomo Proxy Provider")
            && self.tags.iter().any(|tag| tag == "Provider")
    }
}

#[cfg(test)]
mod subscription_tests {
    use super::*;

    fn subscription(description: Option<&str>, tags: &[&str]) -> Subscription {
        Subscription {
            id: "subscription".into(),
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
            allow_override: false,
            user_agent: None,
            headers: HashMap::new(),
            health_check: true,
            test_url: default_proxy_group_test_url(),
            last_updated_at: None,
            description: description.map(ToString::to_string),
            used_traffic: "0 B".into(),
            expires_at: "未知".into(),
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
        }
    }

    #[test]
    fn identifies_legacy_runtime_provider_record() {
        assert!(
            subscription(Some("来自 Mihomo Proxy Provider"), &["Provider"])
                .is_runtime_provider_record()
        );
    }

    #[test]
    fn keeps_user_subscription_with_provider_tag() {
        assert!(!subscription(Some("用户备注"), &["Provider"]).is_runtime_provider_record());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRule {
    pub id: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    pub content: String,
    pub policy: String,
    pub source: String,
    pub enabled: bool,
    pub no_resolve: bool,
    pub wildcard: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRuleOverride {
    #[serde(rename = "targetType")]
    pub target_rule_type: String,
    pub target_content: String,
    pub policy: String,
    pub enabled: bool,
    pub no_resolve: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub app: String,
    pub process: String,
    #[serde(default)]
    pub process_path: String,
    pub icon: String,
    pub target: String,
    pub ip: String,
    pub protocol: String,
    #[serde(default)]
    pub upload_bytes: u64,
    #[serde(default)]
    pub download_bytes: u64,
    pub upload: String,
    pub download: String,
    pub duration: String,
    pub rule: String,
    pub policy: String,
    #[serde(default)]
    pub node: String,
    #[serde(default)]
    pub entry_node: String,
    #[serde(default)]
    pub chain: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRefreshResult {
    pub connections: Vec<Connection>,
    pub upload_total: String,
    pub download_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub time: String,
    pub level: String,
    pub source: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub time: String,
    pub kind: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideItem {
    pub id: String,
    pub match_type: String,
    #[serde(rename = "match")]
    pub item_match: String,
    pub operation: String,
    pub field: String,
    pub value: String,
    pub strategy: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPoint {
    pub time: String,
    #[serde(default)]
    pub sampled_at: i64,
    pub download: f64,
    pub upload: f64,
    #[serde(flatten)]
    pub proxy_groups: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub controller_connected: bool,
    pub controller_url: String,
    pub core_version: String,
    pub upload_total: String,
    pub download_total: String,
    pub last_sync: String,
    #[serde(default)]
    pub tun_enabled: bool,
    #[serde(default)]
    pub process_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayResult {
    pub latency: u32,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSubscriptionRefreshResult {
    pub snapshot: AppSnapshot,
    pub updated: usize,
    pub failed: usize,
    pub skipped: usize,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub theme_mode: ThemeMode,
    pub accent: String,
    pub sidebar_collapsed: bool,
    pub connected: bool,
    pub selected_node_id: String,
    pub selected_group_id: String,
    pub nodes: Vec<ProxyNode>,
    pub groups: Vec<ProxyGroup>,
    #[serde(default)]
    pub proxy_group_overrides: Vec<ProxyGroupMemberOverride>,
    #[serde(default)]
    pub node_dialer_overrides: Vec<ProxyNodeDialerOverride>,
    pub subscriptions: Vec<Subscription>,
    pub rules: Vec<RoutingRule>,
    #[serde(default)]
    pub rule_overrides: Vec<RoutingRuleOverride>,
    pub connections: Vec<Connection>,
    pub logs: Vec<LogEntry>,
    pub activities: Vec<Activity>,
    pub settings: SettingsMap,
    pub domain_overrides: Vec<OverrideItem>,
    pub request_overrides: Vec<OverrideItem>,
    pub response_overrides: Vec<OverrideItem>,
    pub traffic_history: Vec<TrafficPoint>,
    pub runtime: RuntimeInfo,
}
