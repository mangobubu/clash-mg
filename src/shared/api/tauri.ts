import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  AppSettingsPatch,
  AppStatus,
  ConnectionSummary,
  CoreLog,
  CoreStatus,
  ProfileImportInput,
  ProfileSummary,
  ProxyGroup,
} from "../types/domain";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;

const mockProfiles: ProfileSummary[] = [
  { id: "main", name: "主用订阅", source: "remote", updated_at: "刚刚", rule_count: 4288, active: true },
  { id: "backup", name: "备用机场", source: "remote", updated_at: "2 小时前", rule_count: 3016, active: false },
  { id: "local-dev", name: "本地调试", source: "local", updated_at: "昨天", rule_count: 186, active: false },
];

const mockCore: CoreStatus = {
  running: false,
  version: "mihomo-compatible",
  pid: null,
  mode: "Rule",
  mixed_port: 7890,
  controller_url: "http://127.0.0.1:9090",
};

const mockSettings: AppSettings = {
  theme: "light",
  language: "zh-CN",
  auto_start: false,
  silent_start: false,
  system_proxy: true,
  tun_mode: false,
  mixed_port: 7890,
  log_level: "info",
};

const mockConnections: ConnectionSummary[] = [
  {
    id: "c1",
    host: "api.openai.com",
    source_address: "192.168.31.24:54821",
    destination_address: "api.openai.com:443",
    destination_ip: "104.18.33.45",
    destination_domain: "api.openai.com",
    destination_country: "美国",
    destination_country_code: "US",
    connection_type: "https",
    process: "ChatGPT.exe",
    process_path: "C:\\Program Files\\ChatGPT\\ChatGPT.exe",
    network: "tcp",
    chain: ["AI", "美国 06"],
    upload_speed: 204800,
    download_speed: 1880000,
    upload_total: 7340032,
    download_total: 94371840,
    upload: 204800,
    download: 1880000,
    rule: "OpenAI",
    created_at: "10:21:08",
  },
  {
    id: "c2",
    host: "assets.netflix.com",
    source_address: "192.168.31.24:54842",
    destination_address: "assets.netflix.com:443",
    destination_ip: "108.156.120.18",
    destination_domain: "assets.netflix.com",
    destination_country: "日本",
    destination_country_code: "JP",
    connection_type: "https",
    process: "msedge.exe",
    process_path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    network: "tcp",
    chain: ["Streaming", "日本 03"],
    upload_speed: 88420,
    download_speed: 5420000,
    upload_total: 3145728,
    download_total: 250609664,
    upload: 88420,
    download: 5420000,
    rule: "Netflix",
    created_at: "10:22:41",
  },
  {
    id: "c3",
    host: "gateway.icloud.com",
    source_address: "192.168.31.24:5353",
    destination_address: "gateway.icloud.com:443",
    destination_ip: "17.248.192.12",
    destination_domain: "gateway.icloud.com",
    destination_country: "美国",
    destination_country_code: "US",
    connection_type: "quic",
    process: "iCloudDrive.exe",
    process_path: "C:\\Program Files\\WindowsApps\\AppleInc.iCloud\\iCloudDrive.exe",
    network: "udp",
    chain: ["DIRECT"],
    upload_speed: 12240,
    download_speed: 42000,
    upload_total: 889344,
    download_total: 7340032,
    upload: 12240,
    download: 42000,
    rule: "Apple",
    created_at: "10:24:13",
  },
];

function callCommand<T>(command: string, args?: Record<string, unknown>, fallback?: T) {
  if (isTauriRuntime) {
    return invoke<T>(command, args);
  }

  return Promise.resolve(fallback as T);
}

const tauriApi = {
  getAppStatus: () =>
    callCommand<AppStatus>("get_app_status", undefined, {
      app_version: "0.1.0",
      platform: "browser",
      core: mockCore,
      active_profile: mockProfiles[0],
      system_proxy_enabled: true,
    }),
  startCore: () => callCommand<CoreStatus>("start_core", undefined, mockCore),
  stopCore: () => callCommand<CoreStatus>("stop_core", undefined, mockCore),
  restartCore: () => callCommand<CoreStatus>("restart_core", undefined, mockCore),
  listProfiles: () => callCommand<ProfileSummary[]>("list_profiles", undefined, mockProfiles),
  activateProfile: (id: string) =>
    callCommand<ProfileSummary>(
      "activate_profile",
      { id },
      mockProfiles.find((profile) => profile.id === id) ?? mockProfiles[0],
    ),
  importProfile: (input: ProfileImportInput) =>
    callCommand<ProfileSummary>("import_profile", { input }, {
      id: "new-profile",
      name: input.name,
      source: input.source,
      updated_at: "刚刚",
      rule_count: 0,
      active: false,
    }),
  listProxyGroups: () => callCommand<ProxyGroup[]>("list_proxy_groups", undefined, []),
  selectProxy: (group: string, proxy: string) =>
    callCommand<ProxyGroup>("select_proxy", { group, proxy }),
  listConnections: () => callCommand<ConnectionSummary[]>("list_connections", undefined, mockConnections),
  closeConnection: (id: string) => callCommand<void>("close_connection", { id }),
  getSettings: () => callCommand<AppSettings>("get_settings", undefined, mockSettings),
  updateSettings: (patch: AppSettingsPatch) =>
    callCommand<AppSettings>("update_settings", { patch }, { ...mockSettings, ...patch }),
  listLogs: () => callCommand<CoreLog[]>("list_logs", undefined, [
    { source: "core", level: "info", message: "mihomo core manager initialized", timestamp: "10:20:01" },
    { source: "proxy", level: "debug", message: "proxy group AI selected 美国 06", timestamp: "10:21:33" },
  ]),
};

export const api = tauriApi;
