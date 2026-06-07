#[derive(Clone, serde::Serialize)]
pub struct ProxyNode {
    pub name: String,
    pub delay: u32,
    pub alive: bool,
    pub history: Vec<u32>,
}

#[derive(Clone, serde::Serialize)]
pub struct ProxyGroup {
    pub name: String,
    pub r#type: String,
    pub selected: String,
    pub proxies: Vec<ProxyNode>,
}

#[derive(Clone, serde::Serialize)]
pub struct ConnectionSummary {
    pub id: String,
    pub host: String,
    pub source_address: String,
    pub destination_address: String,
    pub destination_ip: String,
    pub destination_domain: String,
    pub destination_country: String,
    pub destination_country_code: String,
    pub connection_type: String,
    pub process: String,
    pub process_path: Option<String>,
    pub network: String,
    pub chain: Vec<String>,
    pub upload_speed: u64,
    pub download_speed: u64,
    pub upload_total: u64,
    pub download_total: u64,
    pub upload: u64,
    pub download: u64,
    pub rule: String,
    pub created_at: String,
}

#[derive(Clone, serde::Serialize)]
pub struct CoreLog {
    pub source: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

pub fn sample_proxy_groups() -> Vec<ProxyGroup> {
    vec![
        group(
            "Proxy",
            "Selector",
            "香港 02",
            vec![("香港 02", 42), ("台湾 01", 68), ("日本 03", 89)],
        ),
        group(
            "AI",
            "Selector",
            "美国 06",
            vec![("美国 06", 128), ("新加坡 01", 77), ("德国 02", 163)],
        ),
        group(
            "Streaming",
            "URLTest",
            "日本 03",
            vec![("日本 03", 91), ("韩国 01", 104), ("美国 02", 139)],
        ),
    ]
}

pub fn sample_connections() -> Vec<ConnectionSummary> {
    vec![
        ConnectionSummary {
            id: "c1".to_string(),
            host: "api.openai.com".to_string(),
            source_address: "192.168.31.24:54821".to_string(),
            destination_address: "api.openai.com:443".to_string(),
            destination_ip: "104.18.33.45".to_string(),
            destination_domain: "api.openai.com".to_string(),
            destination_country: "美国".to_string(),
            destination_country_code: "US".to_string(),
            connection_type: "https".to_string(),
            process: "ChatGPT.exe".to_string(),
            process_path: Some("C:\\Program Files\\ChatGPT\\ChatGPT.exe".to_string()),
            network: "tcp".to_string(),
            chain: vec!["AI".to_string(), "美国 06".to_string()],
            upload_speed: 204_800,
            download_speed: 1_880_000,
            upload_total: 7_340_032,
            download_total: 94_371_840,
            upload: 204_800,
            download: 1_880_000,
            rule: "OpenAI".to_string(),
            created_at: "10:21:08".to_string(),
        },
        ConnectionSummary {
            id: "c2".to_string(),
            host: "assets.netflix.com".to_string(),
            source_address: "192.168.31.24:54842".to_string(),
            destination_address: "assets.netflix.com:443".to_string(),
            destination_ip: "108.156.120.18".to_string(),
            destination_domain: "assets.netflix.com".to_string(),
            destination_country: "日本".to_string(),
            destination_country_code: "JP".to_string(),
            connection_type: "https".to_string(),
            process: "msedge.exe".to_string(),
            process_path: Some("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".to_string()),
            network: "tcp".to_string(),
            chain: vec!["Streaming".to_string(), "日本 03".to_string()],
            upload_speed: 88_420,
            download_speed: 5_420_000,
            upload_total: 3_145_728,
            download_total: 250_609_664,
            upload: 88_420,
            download: 5_420_000,
            rule: "Netflix".to_string(),
            created_at: "10:22:41".to_string(),
        },
        ConnectionSummary {
            id: "c3".to_string(),
            host: "gateway.icloud.com".to_string(),
            source_address: "192.168.31.24:5353".to_string(),
            destination_address: "gateway.icloud.com:443".to_string(),
            destination_ip: "17.248.192.12".to_string(),
            destination_domain: "gateway.icloud.com".to_string(),
            destination_country: "美国".to_string(),
            destination_country_code: "US".to_string(),
            connection_type: "quic".to_string(),
            process: "iCloudDrive.exe".to_string(),
            process_path: Some("C:\\Program Files\\WindowsApps\\AppleInc.iCloud\\iCloudDrive.exe".to_string()),
            network: "udp".to_string(),
            chain: vec!["DIRECT".to_string()],
            upload_speed: 12_240,
            download_speed: 42_000,
            upload_total: 889_344,
            download_total: 7_340_032,
            upload: 12_240,
            download: 42_000,
            rule: "Apple".to_string(),
            created_at: "10:24:13".to_string(),
        },
    ]
}

pub fn sample_logs() -> Vec<CoreLog> {
    vec![
        log("core", "info", "mihomo core manager initialized", "10:20:01"),
        log("profile", "info", "profile 主用订阅 switched to rule mode", "10:20:04"),
        log("proxy", "debug", "proxy group AI selected 美国 06", "10:21:33"),
        log("system", "warning", "core binary is required before real startup", "10:22:19"),
    ]
}

fn group(name: &str, kind: &str, selected: &str, proxies: Vec<(&str, u32)>) -> ProxyGroup {
    ProxyGroup {
        name: name.to_string(),
        r#type: kind.to_string(),
        selected: selected.to_string(),
        proxies: proxies
            .into_iter()
            .map(|(name, delay)| ProxyNode {
                name: name.to_string(),
                delay,
                alive: delay < 180,
                history: vec![delay.saturating_sub(12), delay, delay + 8],
            })
            .collect(),
    }
}

fn log(kind: &str, level: &str, message: &str, timestamp: &str) -> CoreLog {
    CoreLog {
        source: kind.to_string(),
        level: level.to_string(),
        message: message.to_string(),
        timestamp: timestamp.to_string(),
    }
}
