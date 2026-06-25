export type ThemeMode = "light" | "dark" | "system";

export type NodeProtocol = "Shadowsocks" | "VMess" | "Trojan" | "Hysteria2";

export interface ProxyNode {
  id: string;
  name: string;
  country: string;
  flag: string;
  protocol: NodeProtocol;
  address: string;
  port: number;
  latency: number;
  password?: string;
  cipher?: string;
  group: string;
  available: boolean;
}

export type ProxyGroupType = "Selector" | "Fallback" | "URL-Test" | "Load-Balance" | "Direct" | "Block";

export interface ProxyGroup {
  id: string;
  name: string;
  type: ProxyGroupType;
  icon: string;
  description: string;
  nodeIds: string[];
  currentNodeId?: string;
  autoTest: boolean;
  allowManual: boolean;
}

export type SubscriptionType = "HTTP" | "文件导入" | "本地链接";

export interface Subscription {
  id: string;
  name: string;
  type: SubscriptionType;
  url: string;
  nodeCount: number;
  lastUpdated: string;
  updateInterval: number;
  status: "正常" | "更新失败" | "已禁用";
  enabled: boolean;
  autoUpdate: boolean;
  proxyUpdate: boolean;
  allowOverride: boolean;
  description?: string;
  usedTraffic: string;
  expiresAt: string;
  tags: string[];
}

export type RuleType = "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "DOMAIN" | "IP-CIDR" | "RULE-SET" | "GEOIP" | "MATCH";

export interface RoutingRule {
  id: string;
  type: RuleType;
  content: string;
  policy: string;
  source: "本地规则" | "内置规则集" | "内置规则" | "默认规则";
  enabled: boolean;
  noResolve: boolean;
  wildcard: boolean;
  note?: string;
}

export interface Connection {
  id: string;
  app: string;
  process: string;
  icon: string;
  target: string;
  ip: string;
  protocol: "TCP" | "UDP";
  upload: string;
  download: string;
  duration: string;
  rule: string;
  policy: string;
  status: "活跃" | "已关闭";
}

export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARNING" | "ERROR";

export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  content: string;
}

export interface Activity {
  id: string;
  time: string;
  kind: "success" | "switch" | "update" | "shield" | "power";
  content: string;
}

export interface OverrideItem {
  id: string;
  matchType: string;
  match: string;
  operation: string;
  field: string;
  value: string;
  strategy: string;
  enabled: boolean;
}

export type SettingValue = string | number | boolean | string[];
export type AppSettings = Record<string, SettingValue>;

export interface AppState {
  themeMode: ThemeMode;
  accent: string;
  sidebarCollapsed: boolean;
  connected: boolean;
  selectedNodeId: string;
  selectedGroupId: string;
  nodes: ProxyNode[];
  groups: ProxyGroup[];
  subscriptions: Subscription[];
  rules: RoutingRule[];
  connections: Connection[];
  logs: LogEntry[];
  activities: Activity[];
  settings: AppSettings;
  domainOverrides: OverrideItem[];
  requestOverrides: OverrideItem[];
  responseOverrides: OverrideItem[];
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (color: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setConnected: (connected: boolean) => void;
  selectNode: (nodeId: string, groupId?: string) => void;
  selectGroup: (groupId: string) => void;
  addNode: (node: ProxyNode) => void;
  addGroup: (group: ProxyGroup) => void;
  refreshLatencies: () => void;
  addSubscription: (subscription: Subscription) => void;
  updateSubscription: (subscription: Subscription) => void;
  deleteSubscription: (id: string) => void;
  refreshSubscriptions: (ids?: string[]) => void;
  addRule: (rule: RoutingRule) => void;
  updateRule: (rule: RoutingRule) => void;
  deleteRule: (id: string) => void;
  reorderRule: (fromId: string, toId: string) => void;
  closeConnections: (ids: string[]) => void;
  clearClosedConnections: () => void;
  clearLogs: () => void;
  updateSetting: (key: string, value: SettingValue) => void;
  resetSettings: () => void;
  addOverride: (scope: "domain" | "request" | "response", item: OverrideItem) => void;
  updateOverride: (scope: "domain" | "request" | "response", item: OverrideItem) => void;
  deleteOverride: (scope: "domain" | "request" | "response", id: string) => void;
}
