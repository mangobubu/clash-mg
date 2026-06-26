import type {
  Activity,
  AppSettings,
  Connection,
  LogEntry,
  OverrideItem,
  ProxyGroup,
  ProxyNode,
  RoutingRule,
  Subscription,
} from "../types";

export const mockNodes: ProxyNode[] = [
  { id: "hk-01", name: "香港 IEPL 01", country: "香港", flag: "🇭🇰", protocol: "Shadowsocks", address: "103.162.245.76", port: 8388, latency: 38, cipher: "aes-128-gcm", group: "亚洲", available: true },
  { id: "jp-02", name: "日本东京 IEPL 02", country: "日本东京", flag: "🇯🇵", protocol: "Shadowsocks", address: "103.140.136.21", port: 8388, latency: 88, cipher: "chacha20-ietf-poly1305", group: "亚洲", available: true },
  { id: "sg-01", name: "新加坡 SG 01", country: "新加坡", flag: "🇸🇬", protocol: "VMess", address: "45.77.32.18", port: 443, latency: 65, group: "亚洲", available: true },
  { id: "us-01", name: "美国洛杉矶 US LAX 01", country: "美国洛杉矶", flag: "🇺🇸", protocol: "Shadowsocks", address: "104.194.82.11", port: 8388, latency: 145, cipher: "aes-256-gcm", group: "美洲", available: true },
  { id: "au-01", name: "澳大利亚悉尼 AU 01", country: "澳大利亚悉尼", flag: "🇦🇺", protocol: "Trojan", address: "203.28.240.10", port: 443, latency: 157, group: "大洋洲", available: true },
  { id: "tw-01", name: "台湾台北 TW 01", country: "台湾台北", flag: "🇹🇼", protocol: "VMess", address: "61.220.48.96", port: 443, latency: 210, group: "亚洲", available: true },
  { id: "kr-01", name: "韩国首尔 KR 01", country: "韩国首尔", flag: "🇰🇷", protocol: "Shadowsocks", address: "211.45.73.21", port: 8388, latency: 182, cipher: "aes-128-gcm", group: "亚洲", available: true },
  { id: "de-01", name: "德国法兰克福 DE FRA 01", country: "德国法兰克福", flag: "🇩🇪", protocol: "Shadowsocks", address: "185.68.22.17", port: 8388, latency: 201, cipher: "aes-128-gcm", group: "欧洲", available: true },
  { id: "uk-01", name: "英国伦敦 UK 01", country: "英国伦敦", flag: "🇬🇧", protocol: "Hysteria2", address: "51.89.217.31", port: 8443, latency: 168, group: "欧洲", available: false },
];

export const mockGroups: ProxyGroup[] = [
  { id: "auto", name: "自动选择", type: "URL-Test", origin: "managed", icon: "⚡", description: "自动选择延迟最低的节点", nodeIds: mockNodes.map((node) => node.id), currentNodeId: "hk-01", autoTest: true, allowManual: false },
  { id: "fallback", name: "故障转移", type: "Fallback", origin: "managed", icon: "🛡️", description: "节点异常时自动切换", nodeIds: ["hk-01", "jp-02", "sg-01"], currentNodeId: "hk-01", autoTest: true, allowManual: true },
  { id: "manual", name: "手动切换", type: "Selector", origin: "managed", icon: "🌐", description: "手动选择当前使用节点", nodeIds: mockNodes.map((node) => node.id), currentNodeId: "hk-01", autoTest: false, allowManual: true },
  { id: "direct", name: "全球直连", type: "Direct", origin: "local", icon: "↗", description: "不经过代理直接连接", nodeIds: [], autoTest: false, allowManual: false },
  { id: "block", name: "广告拦截", type: "Block", origin: "local", icon: "⊘", description: "拦截匹配到的请求", nodeIds: [], autoTest: false, allowManual: false },
];

export const mockSubscriptions: Subscription[] = [
  { id: "sub-main", name: "机场主订阅", type: "HTTP", url: "https://sub.example.com/main", nodeCount: 128, lastUpdated: "5 分钟前", updateInterval: 12, status: "正常", enabled: true, autoUpdate: true, proxyUpdate: true, allowOverride: false, description: "日常使用的主订阅", usedTraffic: "18.62 GB", expiresAt: "2026-07-30 23:59:59", tags: ["主力", "全球"] },
  { id: "sub-backup", name: "备用订阅", type: "HTTP", url: "https://sub.example.com/backup", nodeCount: 64, lastUpdated: "1 小时前", updateInterval: 24, status: "正常", enabled: true, autoUpdate: true, proxyUpdate: false, allowOverride: false, usedTraffic: "4.21 GB", expiresAt: "2026-08-15 23:59:59", tags: ["备用"] },
  { id: "sub-file", name: "测试订阅", type: "文件导入", url: "local-file.yaml", nodeCount: 18, lastUpdated: "昨天 18:23", updateInterval: 0, status: "正常", enabled: true, autoUpdate: false, proxyUpdate: false, allowOverride: true, usedTraffic: "—", expiresAt: "永久", tags: ["本地"] },
  { id: "sub-hk", name: "香港专线", type: "HTTP", url: "https://sub.example.com/hk", nodeCount: 36, lastUpdated: "2 天前", updateInterval: 6, status: "更新失败", enabled: true, autoUpdate: true, proxyUpdate: true, allowOverride: false, usedTraffic: "11.80 GB", expiresAt: "2026-07-02 23:59:59", tags: ["香港", "专线"] },
  { id: "sub-game", name: "游戏加速", type: "HTTP", url: "https://sub.example.com/game", nodeCount: 22, lastUpdated: "10 分钟前", updateInterval: 12, status: "正常", enabled: true, autoUpdate: true, proxyUpdate: true, allowOverride: false, usedTraffic: "8.43 GB", expiresAt: "2026-09-01 23:59:59", tags: ["游戏"] },
];

export const mockRules: RoutingRule[] = [
  { id: "rule-1", type: "DOMAIN-SUFFIX", content: "openai.com", policy: "ChatGPT", source: "local", enabled: true, noResolve: false, wildcard: false },
  { id: "rule-2", type: "DOMAIN-SUFFIX", content: "youtube.com", policy: "全球直连", source: "local", enabled: true, noResolve: false, wildcard: false },
  { id: "rule-3", type: "RULE-SET", content: "Apple", policy: "全球直连", source: "managed", enabled: true, noResolve: false, wildcard: false },
  { id: "rule-4", type: "DOMAIN-KEYWORD", content: "google", policy: "搜索服务", source: "local", enabled: true, noResolve: false, wildcard: false },
  { id: "rule-5", type: "GEOIP", content: "CN", policy: "直连", source: "managed", enabled: true, noResolve: true, wildcard: false },
  { id: "rule-6", type: "MATCH", content: "漏网之鱼", policy: "代理", source: "managed", enabled: true, noResolve: false, wildcard: false },
];

export const mockConnections: Connection[] = [
  { id: "conn-1", app: "Google Chrome", process: "chrome.exe", icon: "🌐", target: "openai.com:443", ip: "104.18.12.123", protocol: "TCP", upload: "1.2 MB", download: "18.4 MB", duration: "00:04:12", rule: "ChatGPT", policy: "香港 IEPL 01", status: "活跃" },
  { id: "conn-2", app: "Discord", process: "Discord.exe", icon: "🎮", target: "gateway.discord.gg:443", ip: "162.159.134.234", protocol: "TCP", upload: "256 KB", download: "3.1 MB", duration: "00:08:47", rule: "全球直连", policy: "自动选择", status: "活跃" },
  { id: "conn-3", app: "Steam Client", process: "steam.exe", icon: "◉", target: "cdn.steamstatic.com:443", ip: "23.210.204.21", protocol: "TCP", upload: "5.4 MB", download: "12.7 MB", duration: "00:12:35", rule: "媒体分流", policy: "香港 IEPL 01", status: "活跃" },
  { id: "conn-4", app: "verge_mihomo.exe", process: "verge-mihomo.exe", icon: "◆", target: "api.cloudflare.com:443", ip: "104.16.132.229", protocol: "TCP", upload: "420 KB", download: "1.8 MB", duration: "00:02:18", rule: "全球直连", policy: "全球直连", status: "活跃" },
  { id: "conn-5", app: "WeChat", process: "WeChat.exe", icon: "💬", target: "api.weixin.qq.com:443", ip: "123.151.137.18", protocol: "TCP", upload: "180 KB", download: "290 KB", duration: "00:01:45", rule: "全球直连", policy: "自动选择", status: "活跃" },
  { id: "conn-6", app: "Safari", process: "Safari.exe", icon: "🧭", target: "youtube.com:443", ip: "142.251.36.14", protocol: "UDP", upload: "3.2 MB", download: "45.1 MB", duration: "00:15:23", rule: "广告拦截", policy: "香港 IEPL 01", status: "已关闭" },
];

export const mockLogs: LogEntry[] = [
  { id: "log-1", time: "18:15:32", level: "INFO", source: "Core", content: "核心启动成功，已加载配置文件" },
  { id: "log-2", time: "18:15:28", level: "SUCCESS", source: "DNS", content: "DNS 缓存已刷新" },
  { id: "log-3", time: "18:15:23", level: "INFO", source: "系统", content: "代理组“手动切换”切换至“香港 IEPL 01”" },
  { id: "log-4", time: "18:15:18", level: "INFO", source: "TUN", content: "TUN 模式已启用，虚拟网卡：Clash-TUN" },
  { id: "log-5", time: "18:14:55", level: "SUCCESS", source: "订阅", content: "订阅“机场主订阅”更新成功，导入 128 个节点" },
  { id: "log-6", time: "18:14:41", level: "WARNING", source: "规则", content: "规则匹配：openai.com -> ChatGPT" },
  { id: "log-7", time: "18:14:30", level: "INFO", source: "连接", content: "连接关闭：youtube.com:443" },
  { id: "log-8", time: "18:14:12", level: "ERROR", source: "订阅", content: "订阅“香港专线”更新失败：请求超时" },
  { id: "log-9", time: "18:13:58", level: "DEBUG", source: "Core", content: "healthcheck: hk-01 latency=38ms" },
  { id: "log-10", time: "18:13:42", level: "INFO", source: "系统", content: "系统代理端口监听于 127.0.0.1:7890" },
  { id: "log-11", time: "18:13:20", level: "SUCCESS", source: "规则", content: "规则配置校验通过，共加载 6231 条规则" },
  { id: "log-12", time: "18:12:59", level: "DEBUG", source: "DNS", content: "resolve openai.com -> 104.18.12.123" },
];

export const mockActivities: Activity[] = [
  { id: "a1", time: "18:15:32", kind: "success", content: "已连接到节点 香港 IEPL 01" },
  { id: "a2", time: "18:15:28", kind: "switch", content: "切换节点 日本东京 → 香港 IEPL 01" },
  { id: "a3", time: "18:10:45", kind: "update", content: "订阅更新成功" },
  { id: "a4", time: "18:10:30", kind: "shield", content: "系统代理 已启用" },
  { id: "a5", time: "18:10:25", kind: "power", content: "启用启动" },
];

export const trafficData = [
  { time: "18:00", download: 102, upload: 42 }, { time: "20:00", download: 221, upload: 96 },
  { time: "22:00", download: 148, upload: 73 }, { time: "00:00", download: 326, upload: 141 },
  { time: "02:00", download: 198, upload: 91 }, { time: "04:00", download: 235, upload: 104 },
  { time: "06:00", download: 151, upload: 82 }, { time: "08:00", download: 91, upload: 55 },
  { time: "10:00", download: 286, upload: 128 }, { time: "12:00", download: 477, upload: 196 },
  { time: "14:00", download: 278, upload: 113 }, { time: "16:00", download: 365, upload: 176 },
  { time: "18:00", download: 181, upload: 61 },
];

export const proxyGroupTrafficData: Array<Record<string, number | string>> = [
  { time: "18:00", auto: 74, fallback: 18, manual: 44, direct: 29, block: 3 },
  { time: "20:00", auto: 164, fallback: 37, manual: 92, direct: 54, block: 8 },
  { time: "22:00", auto: 95, fallback: 29, manual: 71, direct: 39, block: 6 },
  { time: "00:00", auto: 221, fallback: 45, manual: 132, direct: 78, block: 12 },
  { time: "02:00", auto: 126, fallback: 34, manual: 89, direct: 46, block: 5 },
  { time: "04:00", auto: 148, fallback: 42, manual: 103, direct: 55, block: 7 },
  { time: "06:00", auto: 91, fallback: 24, manual: 64, direct: 38, block: 4 },
  { time: "08:00", auto: 58, fallback: 16, manual: 39, direct: 28, block: 3 },
  { time: "10:00", auto: 172, fallback: 51, manual: 118, direct: 66, block: 9 },
  { time: "12:00", auto: 298, fallback: 79, manual: 188, direct: 91, block: 14 },
  { time: "14:00", auto: 174, fallback: 48, manual: 112, direct: 69, block: 7 },
  { time: "16:00", auto: 232, fallback: 68, manual: 158, direct: 84, block: 11 },
  { time: "18:00", auto: 112, fallback: 22, manual: 62, direct: 41, block: 4 },
];

export const initialSettings: AppSettings = {
  launchAtStartup: true, silentLaunch: false, autoCheckUpdate: true, minimizeOnClose: true, autoConnect: true, language: "简体中文",
  systemProxy: true, allowLan: false, proxyMode: "规则模式", tunMode: true, ipv6: false, firewall: true,
  mixedPort: 7890, httpPort: 7892, uiSecret: "clash-mg-2026", socksPort: 7891, controllerPort: 9090, maxConnections: 32,
  core: "Clash Meta", coreStartTiming: "系统启动时自动运行", coreMode: "规则模式", coreIpv6: true, logLevel: "信息 (Info)", udpForward: true, debugPort: 9090, tcpKeepAlive: true, externalController: 9091, configOverride: "",
  bypassLan: true, bypassChina: true, dnsStrategy: "使用内核 (Fake-IP)", etag: true,
  unifiedDelay: true, connectNearest: true, networkStack: "Mixed", autoRoute: true, strictRoute: false, networkInterface: "系统默认", bindAddress: "0.0.0.0", processMode: "Strict", bypassMainland: true,
  dnsEnabled: true, dnsIpv6: false, dnsListen: "0.0.0.0:1053", enhancedMode: "Fake-IP", overrideSystemDns: true, useHosts: true,
  defaultDns: ["223.5.5.5", "119.29.29.29", "tls://1.1.1.1", "https://dns.google/dns-query"], proxyDns: ["tls://1.1.1.1", "https://dns.google/dns-query"], directDns: ["223.5.5.5", "119.29.29.29"], dnsPolicy: "优先使用代理 DNS",
  fallbackDns: ["1.0.0.1", "8.8.8.8", "https://cloudflare-dns.com/dns-query"], geoIpFilter: true, geoSiteFilter: true, cidrWhitelist: "10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16", domainWhitelist: "*.lan, localhost, *.local", proxyOnlyFallback: false,
  fakeIpRange: "198.18.0.1/16", fakeIpFilter: "*.lan\nlocalhost.ptlogin2.qq.com\nstun.*.*", followRules: true, dnsCache: true, ecs: false, nameServerPolicy: "geosite:private, direct\ngeosite:cn, [223.5.5.5, 119.29.29.29]",
  uiTheme: "浅色", uiScale: "100%", roundedStyle: "标准", glassEffect: true, uiLanguage: "简体中文", defaultPage: "总览", navCollapsed: false, compactMode: false, cardSpacing: "标准", listDensity: "舒适", showStatusFooter: true,
  closeToTray: true, minimizeToTray: false, showTrayIcon: true, uiAnimation: true, operationHints: true, shortcutHints: true,
  logOutput: "文本", timestamp: true, showSource: true, colorLogs: true, silentCoreLog: false, logToFile: true, logPath: "~/logs/clash-mg/app.log", maxLogSize: "10 MB", retentionDays: 7, rotateLogs: true, clearOldLogs: false,
  recordConnections: true, recordDns: false, recordRules: true, recordProxySwitch: true, recordTun: false, filterKeywords: "", excludeKeywords: "healthcheck, ping", realtimeScroll: true, maxLogRows: 1000, showLevelTags: true, collapseDuplicates: false, doubleClickCopy: true,
};

export const mockDomainOverrides: OverrideItem[] = [
  { id: "od-1", matchType: "域名", match: "*.example.com", operation: "Hosts", field: "目标值", value: "203.0.113.1", strategy: "覆盖", enabled: true },
  { id: "od-2", matchType: "域名", match: "api.example.com", operation: "重定向", field: "目标值", value: "https://api.new.com", strategy: "302 临时重定向", enabled: true },
  { id: "od-3", matchType: "域名", match: "ads.example.com", operation: "阻止", field: "目标值", value: "—", strategy: "返回空响应", enabled: true },
  { id: "od-4", matchType: "域名", match: "*.internal.local", operation: "策略", field: "目标值", value: "DIRECT", strategy: "使用指定策略", enabled: true },
];

export const mockRequestOverrides: OverrideItem[] = [
  { id: "orq-1", matchType: "域名通配符", match: "*.example.com", operation: "设置", field: "User-Agent", value: "Clash-MG/1.0", strategy: "请求头", enabled: true },
  { id: "orq-2", matchType: "正则表达式", match: "^https?://.*\\.example\\.com/.*", operation: "删除", field: "X-Forwarded-For", value: "—", strategy: "请求头", enabled: true },
];

export const mockResponseOverrides: OverrideItem[] = [
  { id: "ors-1", matchType: "域名通配符", match: "*.example.com", operation: "设置", field: "Cache-Control", value: "no-store", strategy: "响应头", enabled: true },
  { id: "ors-2", matchType: "域名通配符", match: "*.example.com", operation: "设置", field: "Access-Control-Allow-Origin", value: "*", strategy: "响应头", enabled: true },
];
