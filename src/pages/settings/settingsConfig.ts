export type SettingControl = "switch" | "select" | "input" | "password" | "number" | "textarea" | "tags" | "theme" | "accent";

export interface SettingField {
  key: string;
  label: string;
  description?: string;
  control: SettingControl;
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  span?: 1 | 2;
}

export interface SettingSection {
  title: string;
  description?: string;
  fields: SettingField[];
}

export interface SettingPageDefinition {
  title: string;
  description: string;
  sections: SettingSection[];
}

export const settingDefinitions: Record<string, SettingPageDefinition> = {
  general: {
    title: "常规设置",
    description: "管理应用启动、系统代理、TUN 与端口行为。",
    sections: [
      {
        title: "应用行为",
        fields: [
          { key: "launchAtStartup", label: "开机启动", description: "系统启动时自动运行 Clash-MG", control: "switch" },
          { key: "minimizeOnClose", label: "关闭窗口时最小化到托盘", description: "点击关闭按钮时最小化到系统托盘", control: "switch" },
          { key: "silentLaunch", label: "静默启动", description: "启动时最小化到托盘，不显示主窗口", control: "switch" },
          { key: "autoConnect", label: "启动时自动连接", description: "启动完成后自动连接到上次连接的节点", control: "switch" },
          { key: "autoCheckUpdate", label: "自动检查更新", description: "定期检查新版本并提示更新", control: "switch" },
          { key: "language", label: "语言", description: "选择应用界面语言", control: "select", options: ["简体中文", "繁體中文", "English"] },
        ],
      },
      {
        title: "系统代理与 TUN",
        fields: [
          { key: "systemProxy", label: "系统代理", description: "启用后将系统流量通过代理转发", control: "switch" },
          { key: "tunMode", label: "TUN 模式", description: "启用后将所有流量通过 TUN 接口转发", control: "switch" },
          { key: "allowLan", label: "允许局域网连接", description: "允许来自局域网设备的连接", control: "switch" },
          { key: "ipv6", label: "IPv6", description: "启用 IPv6 支持", control: "switch" },
          { key: "proxyMode", label: "代理模式", description: "选择系统代理的工作模式", control: "select", options: ["规则模式", "全局模式", "直连模式"] },
          { key: "firewall", label: "防火墙集成", description: "自动配置防火墙以放行代理端口", control: "switch" },
        ],
      },
      {
        title: "端口设置",
        fields: [
          { key: "mixedPort", label: "混合端口", description: "HTTP + SOCKS 混合端口", control: "number", min: 1, max: 65535 },
          { key: "socksPort", label: "SOCKS 端口", description: "SOCKS 代理端口", control: "number", min: 1, max: 65535 },
          { key: "httpPort", label: "HTTP 端口", description: "HTTP 代理端口", control: "number", min: 1, max: 65535 },
          { key: "controllerPort", label: "外部控制器", description: "外部控制 API 端口", control: "number", min: 1, max: 65535 },
          { key: "uiSecret", label: "UI Secret", description: "Web UI 访问密钥（留空则不启用）", control: "password" },
          { key: "maxConnections", label: "连接并发限制", description: "最大并发连接数（0 为不限制）", control: "number", min: 0, max: 9999 },
        ],
      },
    ],
  },
  core: {
    title: "核心设置",
    description: "管理 Clash 内核相关配置和行为设置。",
    sections: [
      { title: "内核设置", fields: [
        { key: "core", label: "选择内核", control: "select", options: ["Clash Meta", "Clash Premium"] },
        { key: "coreStartTiming", label: "启动核心时机", control: "select", options: ["系统启动时自动运行", "应用打开时运行", "手动启动"] },
        { key: "coreMode", label: "内核工作模式", control: "select", options: ["规则模式", "全局模式", "直连模式"] },
        { key: "ipv6", label: "IPv6 支持", description: "启用后将支持 IPv6 连接与解析", control: "switch" },
      ] },
      { title: "高级设置", fields: [
        { key: "logLevel", label: "日志级别", control: "select", options: ["调试 (Debug)", "信息 (Info)", "警告 (Warning)", "错误 (Error)"] },
        { key: "tcpKeepAlive", label: "TCP 保持活动", description: "保持 TCP 连接活动以提高稳定性", control: "switch" },
        { key: "udpForward", label: "UDP 转发", description: "允许内核转发 UDP 流量", control: "switch" },
        { key: "externalController", label: "外部控制地址", description: "用于外部程序控制 Clash 内核", control: "input", placeholder: "127.0.0.1:9090" },
        { key: "debugPort", label: "内核调试端口", description: "用于内核调试与性能分析", control: "number", min: 1, max: 65535 },
        { key: "configOverride", label: "配置文件覆盖", description: "使用自定义配置路径覆盖当前配置文件", control: "input", placeholder: "选择配置文件" },
      ] },
      { title: "其他选项", fields: [
        { key: "bypassLan", label: "绕过局域网地址", description: "对局域网地址直连不经过代理", control: "switch" },
        { key: "dnsStrategy", label: "域名解析策略", control: "select", options: ["使用内核 (Fake-IP)", "使用系统 DNS", "Redir-Host"] },
        { key: "bypassChina", label: "绕过中国大陆地址", description: "对中国大陆地址直连不经过代理", control: "switch" },
        { key: "etag", label: "ETag 支持", description: "启用后支持 HTTP ETag 缓存验证", control: "switch" },
      ] },
    ],
  },
  network: {
    title: "网络设置",
    description: "管理代理转发、TUN、监听端口与连接优化选项。",
    sections: [
      { title: "代理与访问", fields: [
        { key: "systemProxy", label: "系统代理", control: "switch" },
        { key: "unifiedDelay", label: "统一延迟测试", control: "switch" },
        { key: "allowLan", label: "允许局域网连接", control: "switch" },
        { key: "connectNearest", label: "启动时自动连接最近节点", control: "switch" },
        { key: "proxyMode", label: "代理模式", control: "select", options: ["规则模式", "全局模式", "直连模式"] },
      ] },
      { title: "TUN 与路由", fields: [
        { key: "tunMode", label: "TUN 模式", control: "switch" },
        { key: "autoRoute", label: "自动路由", control: "switch" },
        { key: "ipv6", label: "IPv6", control: "switch" },
        { key: "strictRoute", label: "严格路由", control: "switch" },
        { key: "networkStack", label: "网络栈", control: "select", options: ["Mixed", "System", "gVisor"] },
        { key: "networkInterface", label: "默认网络接口", control: "select", options: ["系统默认", "以太网", "WLAN"] },
      ] },
      { title: "监听与绑定", fields: [
        { key: "bindAddress", label: "绑定地址", control: "input" },
        { key: "socksPort", label: "SOCKS 端口", control: "number", min: 1, max: 65535 },
        { key: "mixedPort", label: "混合端口", control: "number", min: 1, max: 65535 },
        { key: "controllerPort", label: "外部控制器", control: "number", min: 1, max: 65535 },
        { key: "httpPort", label: "HTTP 端口", control: "number", min: 1, max: 65535 },
        { key: "maxConnections", label: "连接并发限制", control: "number", min: 0, max: 9999 },
      ] },
      { title: "连接优化", fields: [
        { key: "tcpKeepAlive", label: "TCP KeepAlive", control: "switch" },
        { key: "bypassMainland", label: "绕过大陆地址", control: "switch" },
        { key: "udpForward", label: "UDP 转发", control: "switch" },
        { key: "bypassLan", label: "绕过局域网地址", control: "switch" },
        { key: "processMode", label: "进程发现模式", description: "Always 强制识别进程；Strict 由内核按需识别；Off 关闭识别", control: "select", options: ["Always", "Strict", "Off"] },
      ] },
    ],
  },
  interface: {
    title: "界面设置",
    description: "管理主题、布局、字体与界面显示行为。",
    sections: [
      { title: "主题与外观", fields: [
        { key: "uiTheme", label: "主题模式", control: "theme" },
        { key: "uiScale", label: "界面缩放", control: "select", options: ["90%", "100%", "110%", "125%"] },
        { key: "accent", label: "主题色", control: "accent" },
        { key: "roundedStyle", label: "圆角风格", control: "select", options: ["紧凑", "标准", "圆润"] },
        { key: "language", label: "语言", control: "select", options: ["简体中文", "繁體中文", "English"] },
        { key: "glassEffect", label: "毛玻璃效果", control: "switch" },
      ] },
      { title: "布局与导航", fields: [
        { key: "defaultPage", label: "默认启动页", control: "select", options: ["总览", "代理", "订阅", "连接"] },
        { key: "cardSpacing", label: "卡片间距", control: "select", options: ["紧凑", "标准", "宽松"] },
        { key: "navCollapsed", label: "侧边栏折叠", control: "switch" },
        { key: "listDensity", label: "列表密度", control: "select", options: ["紧凑", "舒适", "宽松"] },
        { key: "compactMode", label: "紧凑模式", control: "switch" },
        { key: "showStatusFooter", label: "显示底部状态信息", control: "switch" },
      ] },
      { title: "窗口与交互", fields: [
        { key: "uiAnimation", label: "启用界面动画", control: "switch" },
        { key: "minimizeToTray", label: "最小化到托盘", control: "switch" },
        { key: "operationHints", label: "显示操作提示", control: "switch" },
        { key: "showTrayIcon", label: "显示托盘图标", control: "switch" },
        { key: "shortcutHints", label: "快捷键提示", control: "switch" },
      ] },
    ],
  },
  log: {
    title: "日志设置",
    description: "管理日志级别、输出方式、持久化与调试行为。",
    sections: [
      { title: "基础日志", fields: [
        { key: "logLevel", label: "日志级别", control: "select", options: ["Debug", "Info", "Warning", "Error"] },
        { key: "showSource", label: "显示来源模块", control: "switch" },
        { key: "logOutput", label: "日志输出格式", control: "select", options: ["文本", "JSON"] },
        { key: "colorLogs", label: "彩色日志输出", control: "switch" },
        { key: "timestamp", label: "启用时间戳", control: "switch" },
        { key: "silentCoreLog", label: "静默启动日志", control: "switch" },
      ] },
      { title: "持久化与文件", fields: [
        { key: "logToFile", label: "启用日志写入文件", control: "switch" },
        { key: "retentionDays", label: "保留天数", control: "number", min: 1, max: 365 },
        { key: "logPath", label: "日志文件路径", control: "input" },
        { key: "rotateLogs", label: "自动轮转日志", control: "switch" },
        { key: "maxLogSize", label: "最大日志文件大小", control: "select", options: ["5 MB", "10 MB", "20 MB", "50 MB"] },
        { key: "clearOldLogs", label: "启动时清理旧日志", control: "switch" },
      ] },
      { title: "调试与过滤", fields: [
        { key: "recordConnections", label: "记录连接事件", control: "switch" },
        { key: "recordProxySwitch", label: "记录代理切换", control: "switch" },
        { key: "recordDns", label: "记录 DNS 查询", control: "switch" },
        { key: "recordTun", label: "记录 TUN 事件", control: "switch" },
        { key: "recordRules", label: "记录规则匹配", control: "switch" },
        { key: "filterKeywords", label: "过滤关键字", control: "input", placeholder: "输入关键字，多个用逗号分隔" },
        { key: "excludeKeywords", label: "排除关键字", control: "input", placeholder: "如 healthcheck, ping" },
      ] },
      { title: "显示与查看器", fields: [
        { key: "realtimeScroll", label: "实时自动滚动", control: "switch" },
        { key: "showLevelTags", label: "显示级别标签", control: "switch" },
        { key: "maxLogRows", label: "最大显示行数", control: "number", min: 100, max: 10000 },
        { key: "collapseDuplicates", label: "折叠重复日志", control: "switch" },
        { key: "doubleClickCopy", label: "双击复制日志", control: "switch" },
      ] },
    ],
  },
};
