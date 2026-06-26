import { invoke } from "@tauri-apps/api/core";
import { createEmptyAppData } from "../defaults/appDefaults";
import type { AppData, AppSettings, DelayResult } from "../types";
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

export async function refreshRuntimeSnapshot(snapshot: AppData) {
  if (!(await isTauriRuntime())) return snapshot;
  return invoke<AppData>("refresh_runtime_data", { snapshot });
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

export async function testRuntimeProxyDelay(settings: AppSettings, nodeName: string): Promise<DelayResult> {
  if (!(await isTauriRuntime())) return { latency: 0, available: false, message: "浏览器预览环境无法访问 Mihomo 控制器" };
  return invoke<DelayResult>("test_proxy_delay", { settings, nodeName });
}

function loadBrowserSnapshot() {
  const fallback = createEmptyAppData();
  const raw = localStorage.getItem(browserStorageKey);
  if (!raw) return fallback;

  try {
    return { ...fallback, ...JSON.parse(raw) } as AppData;
  } catch {
    return fallback;
  }
}
