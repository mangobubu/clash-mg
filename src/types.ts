export type ThemeMode = "light" | "dark" | "system";

export type NodeProtocol = string;
export type NodeOrigin = "managed" | "local";

export interface ProxyNode {
  id: string;
  name: string;
  country?: string;
  flag?: string;
  protocol: NodeProtocol;
  address: string;
  port: number;
  latency: number;
  password?: string;
  cipher?: string;
  dialerProxy?: string;
  group?: string;
  origin?: NodeOrigin;
  available: boolean;
}

export type ProxyGroupType = "Selector" | "Fallback" | "URL-Test" | "Load-Balance" | "Direct" | "Block";
export type ProxyGroupOrigin = "managed" | "local";

export interface ProxyGroup {
  id: string;
  name: string;
  type: ProxyGroupType;
  origin: ProxyGroupOrigin;
  icon: string;
  description: string;
  nodeIds: string[];
  groupIds: string[];
  currentNodeId?: string;
  autoTest: boolean;
  allowManual: boolean;
}

export interface ProxyGroupMemberOverride {
  targetGroupId: string;
  targetGroupName: string;
  addedGroupIds: string[];
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
export type RuleOrigin = "managed" | "local";

export interface RoutingRule {
  id: string;
  type: RuleType;
  content: string;
  policy: string;
  source: RuleOrigin;
  enabled: boolean;
  noResolve: boolean;
  wildcard: boolean;
  note?: string;
}

export interface RoutingRuleOverride {
  targetType: RuleType;
  targetContent: string;
  policy: string;
  enabled: boolean;
  noResolve: boolean;
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
  node: string;
  chain: string[];
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

export interface TrafficPoint {
  time: string;
  download: number;
  upload: number;
  [key: string]: number | string;
}

export interface RuntimeInfo {
  controllerConnected: boolean;
  controllerUrl: string;
  coreVersion: string;
  uploadTotal: string;
  downloadTotal: string;
  lastSync: string;
  tunEnabled: boolean;
  processMode: string;
  error?: string;
}

export interface DelayResult {
  latency: number;
  available: boolean;
  message?: string;
}

export interface MihomoCoreStatus {
  exists: boolean;
  path: string;
}

export interface MihomoCoreLaunchResult {
  started: boolean;
  controllerReady: boolean;
  message: string;
}

export interface MihomoCoreDownloadProgress {
  status: "resolving" | "downloading" | "extracting" | "completed" | "failed";
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSecond: number;
  percent: number;
  message?: string;
}

export type SettingValue = string | number | boolean | string[];
export type AppSettings = Record<string, SettingValue>;

export interface AppData {
  themeMode: ThemeMode;
  accent: string;
  sidebarCollapsed: boolean;
  connected: boolean;
  selectedNodeId: string;
  selectedGroupId: string;
  nodes: ProxyNode[];
  groups: ProxyGroup[];
  proxyGroupOverrides: ProxyGroupMemberOverride[];
  subscriptions: Subscription[];
  rules: RoutingRule[];
  ruleOverrides: RoutingRuleOverride[];
  connections: Connection[];
  logs: LogEntry[];
  activities: Activity[];
  settings: AppSettings;
  domainOverrides: OverrideItem[];
  requestOverrides: OverrideItem[];
  responseOverrides: OverrideItem[];
  trafficHistory: TrafficPoint[];
  runtime: RuntimeInfo;
}

export interface LocalSubscriptionRefreshResult {
  snapshot: AppData;
  updated: number;
  failed: number;
  skipped: number;
  messages: string[];
}

export interface SubscriptionRefreshResult {
  updated: number;
  failed: number;
  skipped: number;
  localUpdated: number;
  providerUpdated: number;
  messages: string[];
}

export interface AppState extends AppData {
  hydrated: boolean;
  backendAvailable: boolean;
  initializeAppState: () => Promise<void>;
  refreshRuntimeData: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (color: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setConnected: (connected: boolean) => void;
  selectProxy: (proxyId: string, groupId?: string) => void;
  selectGroup: (groupId: string) => void;
  addNode: (node: ProxyNode) => void;
  updateNode: (node: ProxyNode) => void;
  updateNodeLatency: (nodeId: string, latency: number, available?: boolean) => void;
  testNodeLatency: (nodeId: string) => Promise<DelayResult>;
  addGroup: (group: ProxyGroup) => void;
  updateGroup: (group: ProxyGroup) => void;
  setProxyGroupOverride: (targetGroup: ProxyGroup, addedGroupIds: string[]) => void;
  refreshLatencies: () => void;
  addSubscription: (subscription: Subscription) => void;
  updateSubscription: (subscription: Subscription) => void;
  deleteSubscription: (id: string) => Promise<void>;
  refreshSubscriptions: (ids?: string[]) => Promise<SubscriptionRefreshResult>;
  addRule: (rule: RoutingRule) => void;
  updateRule: (rule: RoutingRule) => void;
  setRuleOverride: (targetRule: RoutingRule, overrideRule: RoutingRule) => void;
  clearRuleOverride: (targetRule: RoutingRule) => void;
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
