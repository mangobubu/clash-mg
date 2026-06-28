use std::collections::HashMap;

use chrono::Local;
use serde_json::{json, Value};

use crate::models::{AppSnapshot, RuntimeInfo, SettingsMap, ThemeMode};

pub fn current_time() -> String {
    Local::now().format("%H:%M:%S").to_string()
}

pub fn default_settings() -> SettingsMap {
    HashMap::from([
        ("launchAtStartup".into(), json!(false)),
        ("silentLaunch".into(), json!(false)),
        ("autoCheckUpdate".into(), json!(true)),
        ("minimizeOnClose".into(), json!(true)),
        ("autoConnect".into(), json!(true)),
        ("language".into(), json!("简体中文")),
        ("systemProxy".into(), json!(false)),
        ("allowLan".into(), json!(false)),
        ("proxyMode".into(), json!("规则模式")),
        ("tunMode".into(), json!(false)),
        ("ipv6".into(), json!(false)),
        ("firewall".into(), json!(false)),
        ("mixedPort".into(), json!(7890)),
        ("httpPort".into(), json!(7892)),
        ("uiSecret".into(), json!("")),
        ("socksPort".into(), json!(7891)),
        ("controllerPort".into(), json!(9090)),
        ("maxConnections".into(), json!(32)),
        ("core".into(), json!("Mihomo")),
        ("coreStartTiming".into(), json!("手动启动")),
        ("coreMode".into(), json!("规则模式")),
        ("coreIpv6".into(), json!(false)),
        ("logLevel".into(), json!("信息 (Info)")),
        ("udpForward".into(), json!(true)),
        ("debugPort".into(), json!(9090)),
        ("tcpKeepAlive".into(), json!(true)),
        ("externalController".into(), json!("127.0.0.1:9090")),
        ("configOverride".into(), json!("")),
        ("bypassLan".into(), json!(true)),
        ("bypassChina".into(), json!(true)),
        ("dnsStrategy".into(), json!("使用内核 (Fake-IP)")),
        ("etag".into(), json!(true)),
        ("unifiedDelay".into(), json!(true)),
        ("connectNearest".into(), json!(true)),
        ("networkStack".into(), json!("Mixed")),
        ("autoRoute".into(), json!(true)),
        ("strictRoute".into(), json!(false)),
        ("networkInterface".into(), json!("系统默认")),
        ("bindAddress".into(), json!("0.0.0.0")),
        ("processMode".into(), json!("Always")),
        ("processModeDefaultV2".into(), json!(true)),
        ("bypassMainland".into(), json!(true)),
        ("dnsEnabled".into(), json!(true)),
        ("dnsIpv6".into(), json!(false)),
        ("dnsListen".into(), json!("0.0.0.0:1053")),
        ("enhancedMode".into(), json!("Fake-IP")),
        ("overrideSystemDns".into(), json!(false)),
        ("useHosts".into(), json!(true)),
        ("defaultDns".into(), json!(["223.5.5.5", "119.29.29.29"])),
        (
            "proxyDns".into(),
            json!(["tls://1.1.1.1", "https://dns.google/dns-query"]),
        ),
        ("directDns".into(), json!(["223.5.5.5", "119.29.29.29"])),
        ("dnsPolicy".into(), json!("优先使用代理 DNS")),
        ("fallbackDns".into(), json!(["1.0.0.1", "8.8.8.8"])),
        ("geoIpFilter".into(), json!(true)),
        ("geoSiteFilter".into(), json!(true)),
        (
            "cidrWhitelist".into(),
            json!("10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16"),
        ),
        ("domainWhitelist".into(), json!("*.lan, localhost, *.local")),
        ("proxyOnlyFallback".into(), json!(false)),
        ("fakeIpRange".into(), json!("198.18.0.1/16")),
        (
            "fakeIpFilter".into(),
            json!("*.lan\nlocalhost.ptlogin2.qq.com\nstun.*.*"),
        ),
        ("followRules".into(), json!(true)),
        ("dnsCache".into(), json!(true)),
        ("ecs".into(), json!(false)),
        (
            "nameServerPolicy".into(),
            json!("geosite:private, direct\ngeosite:cn, [223.5.5.5, 119.29.29.29]"),
        ),
        ("uiTheme".into(), json!("浅色")),
        ("uiScale".into(), json!("100%")),
        ("roundedStyle".into(), json!("标准")),
        ("glassEffect".into(), json!(true)),
        ("uiLanguage".into(), json!("简体中文")),
        ("defaultPage".into(), json!("总览")),
        ("navCollapsed".into(), json!(false)),
        ("compactMode".into(), json!(false)),
        ("cardSpacing".into(), json!("标准")),
        ("listDensity".into(), json!("舒适")),
        ("showStatusFooter".into(), json!(true)),
        ("closeToTray".into(), json!(true)),
        ("minimizeToTray".into(), json!(false)),
        ("showTrayIcon".into(), json!(true)),
        ("uiAnimation".into(), json!(true)),
        ("operationHints".into(), json!(true)),
        ("shortcutHints".into(), json!(true)),
        ("logOutput".into(), json!("文本")),
        ("timestamp".into(), json!(true)),
        ("showSource".into(), json!(true)),
        ("colorLogs".into(), json!(true)),
        ("silentCoreLog".into(), json!(false)),
        ("logToFile".into(), json!(true)),
        ("logPath".into(), json!("~/logs/clash-mg/app.log")),
        ("maxLogSize".into(), json!("10 MB")),
        ("retentionDays".into(), json!(7)),
        ("rotateLogs".into(), json!(true)),
        ("clearOldLogs".into(), json!(false)),
        ("recordConnections".into(), json!(true)),
        ("recordDns".into(), json!(false)),
        ("recordRules".into(), json!(true)),
        ("recordProxySwitch".into(), json!(true)),
        ("recordTun".into(), json!(false)),
        ("filterKeywords".into(), json!("")),
        ("excludeKeywords".into(), json!("healthcheck, ping")),
        ("realtimeScroll".into(), json!(true)),
        ("maxLogRows".into(), json!(1000)),
        ("showLevelTags".into(), json!(true)),
        ("collapseDuplicates".into(), json!(false)),
        ("doubleClickCopy".into(), json!(true)),
    ])
}

pub fn merge_default_settings(settings: &mut SettingsMap) {
    if !settings.contains_key("processModeDefaultV2") {
        if settings
            .get("processMode")
            .and_then(Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("strict"))
        {
            settings.insert("processMode".into(), json!("Always"));
        }
        settings.insert("processModeDefaultV2".into(), json!(true));
    }
    for (key, value) in default_settings() {
        settings.entry(key).or_insert(value);
    }
}

pub fn default_snapshot() -> AppSnapshot {
    AppSnapshot {
        theme_mode: ThemeMode::Light,
        accent: "#12b8c4".into(),
        sidebar_collapsed: false,
        connected: false,
        selected_node_id: String::new(),
        selected_group_id: String::new(),
        nodes: Vec::new(),
        groups: Vec::new(),
        proxy_group_overrides: Vec::new(),
        subscriptions: Vec::new(),
        rules: Vec::new(),
        rule_overrides: Vec::new(),
        connections: Vec::new(),
        logs: Vec::new(),
        activities: Vec::new(),
        settings: default_settings(),
        domain_overrides: Vec::new(),
        request_overrides: Vec::new(),
        response_overrides: Vec::new(),
        traffic_history: Vec::new(),
        runtime: RuntimeInfo {
            controller_connected: false,
            controller_url: "http://127.0.0.1:9090".into(),
            core_version: "未连接".into(),
            upload_total: "0 B".into(),
            download_total: "0 B".into(),
            last_sync: current_time(),
            tun_enabled: false,
            process_mode: "未连接".into(),
            error: None,
        },
    }
}

pub fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}
