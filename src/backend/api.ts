import { invoke } from "@tauri-apps/api/core";
import { createEmptyAppData } from "../defaults/appDefaults";
import type {
  AppData,
  AppSettings,
  AppUpdateInfo,
  ConnectionRefreshResult,
  DelayResult,
  LocalSubscriptionRefreshResult,
  MihomoCoreLaunchResult,
  RunningProcess,
  TunServiceStatus,
} from "../types";
import { isTauriRuntime } from "../utils/tauri";

const browserStorageKey = "clash-mg-app-state";

export async function loadAppSnapshot(): Promise<{ data: AppData; backendAvailable: boolean }> {
  if (await isTauriRuntime()) {
    const data = await invoke<AppData>("get_app_snapshot");
    return { data, backendAvailable: true };
  }

  return { data: loadBrowserSnapshot(), backendAvailable: false };
}

export async function saveAppSnapshot(snapshot: AppData) {
  if (await isTauriRuntime()) {
    await invoke("save_app_snapshot", { snapshot });
    return;
  }

  localStorage.setItem(browserStorageKey, JSON.stringify(snapshot));
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (!(await isTauriRuntime())) {
    return {
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/mangobubu/clash-mg/releases",
      releaseNotes: "",
    };
  }
  return invoke<AppUpdateInfo>("check_app_update");
}

export async function refreshRuntimeSnapshot(snapshot: AppData) {
  if (!(await isTauriRuntime())) return snapshot;
  return invoke<AppData>("refresh_runtime_data", { snapshot });
}

export async function refreshRuntimeConnections(snapshot: AppData): Promise<ConnectionRefreshResult> {
  if (!(await isTauriRuntime())) {
    return {
      connections: snapshot.connections,
      uploadTotal: snapshot.runtime.uploadTotal,
      downloadTotal: snapshot.runtime.downloadTotal,
    };
  }
  return invoke<ConnectionRefreshResult>("refresh_runtime_connections", {
    settings: snapshot.settings,
    nodes: snapshot.nodes,
  });
}

export async function selectRuntimeProxy(snapshot: AppData, groupName: string, nodeName: string) {
  if (!(await isTauriRuntime())) return snapshot;
  return invoke<AppData>("select_proxy_node", { snapshot, groupName, nodeName });
}

export async function closeRuntimeConnections(snapshot: AppData, ids: string[]) {
  if (!(await isTauriRuntime())) return snapshot;
  return invoke<AppData>("close_runtime_connections", { snapshot, ids });
}

export async function refreshRuntimeProviders(snapshot: AppData, providerNames: string[]) {
  if (!(await isTauriRuntime())) return snapshot;
  return invoke<AppData>("refresh_proxy_providers", { snapshot, providerNames });
}

export async function refreshLocalSubscriptions(snapshot: AppData, subscriptionIds: string[]): Promise<LocalSubscriptionRefreshResult> {
  if (!(await isTauriRuntime())) {
    return {
      snapshot,
      updated: 0,
      failed: 0,
      skipped: subscriptionIds.length,
      messages: ["浏览器预览环境无法下载订阅"],
    };
  }

  return invoke<LocalSubscriptionRefreshResult>("refresh_local_subscriptions", { snapshot, subscriptionIds });
}

export async function deleteLocalSubscription(snapshot: AppData, subscriptionId: string): Promise<AppData> {
  if (!(await isTauriRuntime())) {
    const next = {
      ...snapshot,
      subscriptions: snapshot.subscriptions.filter((subscription) => subscription.id !== subscriptionId),
    };
    localStorage.setItem(browserStorageKey, JSON.stringify(next));
    return next;
  }

  return invoke<AppData>("delete_local_subscription", { snapshot, subscriptionId });
}

export async function testRuntimeProxyDelay(settings: AppSettings, nodeName: string): Promise<DelayResult> {
  if (!(await isTauriRuntime())) return { latency: 0, available: false, message: "浏览器预览环境无法访问 Mihomo 控制器" };
  return invoke<DelayResult>("test_proxy_delay", { settings, nodeName });
}

export async function startMihomoCore(settings: AppSettings): Promise<MihomoCoreLaunchResult> {
  if (!(await isTauriRuntime())) return { started: false, controllerReady: false, message: "浏览器预览环境无法启动 Mihomo 内核" };
  return invoke<MihomoCoreLaunchResult>("start_mihomo_core", { settings });
}

export async function getTunServiceStatus(): Promise<TunServiceStatus> {
  if (!(await isTauriRuntime())) {
    return { installed: false, running: false, versionCompatible: false, message: "浏览器预览环境无法访问系统服务" };
  }
  return invoke<TunServiceStatus>("get_tun_service_status");
}

export async function installTunService(): Promise<TunServiceStatus> {
  if (!(await isTauriRuntime())) throw new Error("浏览器预览环境无法安装系统服务");
  return invoke<TunServiceStatus>("install_tun_service");
}

export async function uninstallTunService(): Promise<TunServiceStatus> {
  if (!(await isTauriRuntime())) throw new Error("浏览器预览环境无法删除系统服务");
  return invoke<TunServiceStatus>("uninstall_tun_service");
}

export async function listRunningProcesses(): Promise<RunningProcess[]> {
  if (!(await isTauriRuntime())) return [];
  return invoke<RunningProcess[]>("list_running_processes");
}

function loadBrowserSnapshot() {
  const fallback = createEmptyAppData();
  const raw = localStorage.getItem(browserStorageKey);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const storedSettings = { ...(parsed.settings ?? {}) };
    if (storedSettings.coreIpv6 !== undefined) {
      storedSettings.ipv6 = storedSettings.coreIpv6;
      delete storedSettings.coreIpv6;
    }
    if (storedSettings.language === undefined && storedSettings.uiLanguage !== undefined) {
      storedSettings.language = storedSettings.uiLanguage;
    }
    delete storedSettings.uiLanguage;
    return {
      ...fallback,
      ...parsed,
      settings: { ...fallback.settings, ...storedSettings },
    } as AppData;
  } catch {
    return fallback;
  }
}

export async function getLanIp(): Promise<string> {
  if (await isTauriRuntime()) {
    return invoke<string>("get_lan_ip");
  }
  return "127.0.0.1";
}
