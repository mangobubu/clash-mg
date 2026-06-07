export type CoreStatus = {
  running: boolean;
  version: string;
  pid?: number | null;
  mode: "Rule" | "Global" | "Direct";
  mixed_port: number;
  controller_url: string;
};

export type AppStatus = {
  app_version: string;
  platform: string;
  core: CoreStatus;
  active_profile?: ProfileSummary | null;
  system_proxy_enabled: boolean;
};

export type ProfileSummary = {
  id: string;
  name: string;
  source: "local" | "remote";
  updated_at: string;
  rule_count: number;
  active: boolean;
};

export type ProfileImportInput = {
  name: string;
  source: "local" | "remote";
  path?: string;
  url?: string;
};

export type ProxyNode = {
  name: string;
  delay: number;
  alive: boolean;
  history: number[];
};

export type ProxyGroup = {
  name: string;
  type: "Selector" | "URLTest" | "Fallback" | "LoadBalance";
  selected: string;
  proxies: ProxyNode[];
};

export type ConnectionSummary = {
  id: string;
  host: string;
  source_address?: string;
  destination_address?: string;
  destination_ip?: string;
  destination_domain?: string;
  destination_country?: string;
  destination_country_code?: string;
  connection_type?: string;
  process: string;
  process_path?: string | null;
  network: "tcp" | "udp";
  chain: string[];
  upload_speed?: number;
  download_speed?: number;
  upload_total?: number;
  download_total?: number;
  upload: number;
  download: number;
  rule: string;
  created_at: string;
};

export type AppSettings = {
  theme: "light" | "dark";
  language: "zh-CN" | "en-US";
  auto_start: boolean;
  silent_start: boolean;
  system_proxy: boolean;
  tun_mode: boolean;
  mixed_port: number;
  log_level: "debug" | "info" | "warning" | "error";
};

export type AppSettingsPatch = Partial<AppSettings>;

export type CoreLogSource = "core" | "profile" | "proxy" | "system";
export type CoreLogLevel = "debug" | "info" | "warning" | "error";

export type CoreLog = {
  source: CoreLogSource;
  level: CoreLogLevel;
  message: string;
  timestamp: string;
};
