import { create } from "zustand";
import {
  closeRuntimeConnections,
  loadAppSnapshot,
  refreshRuntimeProviders,
  refreshRuntimeSnapshot,
  saveAppSnapshot,
  selectRuntimeProxy,
  testRuntimeProxyDelay,
} from "../backend/api";
import { createEmptyAppData, defaultSettings } from "../defaults/appDefaults";
import type { AppData, AppState, DelayResult, OverrideItem } from "../types";

const currentTime = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

type OverrideScope = "domain" | "request" | "response";
type OverrideKey = "domainOverrides" | "requestOverrides" | "responseOverrides";

const overrideKeyByScope: Record<OverrideScope, OverrideKey> = {
  domain: "domainOverrides",
  request: "requestOverrides",
  response: "responseOverrides",
};

const emptyAppData = createEmptyAppData();
let persistTimer: number | undefined;

const toAppData = (state: AppState): AppData => ({
  themeMode: state.themeMode,
  accent: state.accent,
  sidebarCollapsed: state.sidebarCollapsed,
  connected: state.connected,
  selectedNodeId: state.selectedNodeId,
  selectedGroupId: state.selectedGroupId,
  nodes: state.nodes,
  groups: state.groups,
  subscriptions: state.subscriptions,
  rules: state.rules,
  connections: state.connections,
  logs: state.logs,
  activities: state.activities,
  settings: state.settings,
  domainOverrides: state.domainOverrides,
  requestOverrides: state.requestOverrides,
  responseOverrides: state.responseOverrides,
  trafficHistory: state.trafficHistory,
  runtime: state.runtime,
});

const queuePersist = () => {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void saveAppSnapshot(toAppData(useAppStore.getState())).catch((error) => {
      console.error("应用状态保存失败", error);
    });
  }, 120);
};

const applySnapshot = (snapshot: AppData, backendAvailable = true) => {
  useAppStore.setState({
    ...snapshot,
    hydrated: true,
    backendAvailable,
  });
};

const appendLog = (level: string, source: string, content: string) => {
  useAppStore.setState((state) => ({
    logs: [
      {
        id: crypto.randomUUID(),
        time: currentTime(),
        level: level as AppState["logs"][number]["level"],
        source,
        content,
      },
      ...state.logs,
    ].slice(0, Number(state.settings.maxLogRows ?? 1000)),
  }));
  queuePersist();
};

const updateOverrideList = (
  state: AppState,
  scope: OverrideScope,
  updater: (items: OverrideItem[]) => OverrideItem[],
) => {
  const key = overrideKeyByScope[scope];
  return { [key]: updater(state[key]) } as Pick<AppState, OverrideKey>;
};

export const useAppStore = create<AppState>()((set, get) => ({
  ...emptyAppData,
  hydrated: false,
  backendAvailable: false,

  initializeAppState: async () => {
    try {
      const { data, backendAvailable } = await loadAppSnapshot();
      applySnapshot(data, backendAvailable);
      if (backendAvailable) void get().refreshRuntimeData();
    } catch (error) {
      console.error(error);
      set({ ...createEmptyAppData(), hydrated: true, backendAvailable: false });
      appendLog("ERROR", "后端", `应用数据加载失败：${String(error)}`);
    }
  },

  refreshRuntimeData: async () => {
    try {
      const snapshot = await refreshRuntimeSnapshot(toAppData(get()));
      applySnapshot(snapshot, true);
    } catch (error) {
      console.error(error);
      set((state) => ({
        runtime: {
          ...state.runtime,
          controllerConnected: false,
          error: String(error),
          lastSync: currentTime(),
        },
        connected: false,
      }));
      appendLog("ERROR", "控制器", `运行数据刷新失败：${String(error)}`);
    }
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    queuePersist();
  },
  setAccent: (accent) => {
    set({ accent });
    queuePersist();
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed });
    queuePersist();
  },
  setConnected: (connected) => {
    set((state) => ({
      connected,
      activities: [
        {
          id: crypto.randomUUID(),
          time: currentTime(),
          kind: connected ? "power" : "switch",
          content: connected ? "已恢复连接状态显示" : "已暂停连接状态显示",
        },
        ...state.activities,
      ],
    }));
    queuePersist();
  },
  selectNode: (nodeId, groupId) => {
    set((state) => {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) return state;
      const targetGroupId = groupId ?? state.selectedGroupId;
      return {
        selectedNodeId: nodeId,
        groups: state.groups.map((group) =>
          group.id === targetGroupId ? { ...group, currentNodeId: nodeId } : group,
        ),
        logs: [
          { id: crypto.randomUUID(), time: currentTime(), level: "SUCCESS", source: "代理", content: `已切换至节点“${node.name}”` },
          ...state.logs,
        ],
        activities: [
          { id: crypto.randomUUID(), time: currentTime(), kind: "switch", content: `切换节点至 ${node.name}` },
          ...state.activities,
        ],
      };
    });
    queuePersist();

    const current = get();
    const group = current.groups.find((item) => item.id === (groupId ?? current.selectedGroupId));
    const node = current.nodes.find((item) => item.id === nodeId);
    if (group?.origin === "managed" && node) {
      void selectRuntimeProxy(toAppData(current), group.name, node.name)
        .then((snapshot) => applySnapshot(snapshot, true))
        .catch((error) => appendLog("ERROR", "代理", `Mihomo 代理切换失败：${String(error)}`));
    }
  },
  selectGroup: (selectedGroupId) => {
    set({ selectedGroupId });
    queuePersist();
  },
  addNode: (node) => {
    set((state) => ({ nodes: [node, ...state.nodes] }));
    queuePersist();
  },
  updateNode: (node) => {
    set((state) => ({ nodes: state.nodes.map((item) => (item.id === node.id ? node : item)) }));
    queuePersist();
  },
  updateNodeLatency: (nodeId, latency, available) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, latency, available: available ?? node.available } : node,
      ),
    }));
    queuePersist();
  },
  testNodeLatency: async (nodeId): Promise<DelayResult> => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return { latency: 0, available: false, message: "节点不存在" };

    const result = await testRuntimeProxyDelay(get().settings, node.name);
    get().updateNodeLatency(nodeId, result.latency, result.available);
    if (result.message) appendLog("WARNING", "测速", `${node.name} 测速失败：${result.message}`);
    return result;
  },
  addGroup: (group) => {
    set((state) => ({ groups: [...state.groups, group] }));
    queuePersist();
  },
  updateGroup: (group) => {
    set((state) => ({ groups: state.groups.map((item) => (item.id === group.id ? group : item)) }));
    queuePersist();
  },
  refreshLatencies: () => {
    const ids = get().nodes.map((node) => node.id);
    void Promise.all(ids.map((id) => get().testNodeLatency(id)));
  },

  addSubscription: (subscription) => {
    set((state) => ({
      subscriptions: [subscription, ...state.subscriptions],
      logs: [
        { id: crypto.randomUUID(), time: currentTime(), level: "SUCCESS", source: "订阅", content: `已添加订阅“${subscription.name}”` },
        ...state.logs,
      ],
    }));
    queuePersist();
  },
  updateSubscription: (subscription) => {
    set((state) => ({ subscriptions: state.subscriptions.map((item) => (item.id === subscription.id ? subscription : item)) }));
    queuePersist();
  },
  deleteSubscription: (id) => {
    set((state) => ({ subscriptions: state.subscriptions.filter((item) => item.id !== id) }));
    queuePersist();
  },
  refreshSubscriptions: (ids) => {
    const current = get();
    const targets = current.subscriptions.filter((subscription) => !ids || ids.includes(subscription.id));
    const providerNames = targets.filter((subscription) => subscription.tags.includes("Provider")).map((subscription) => subscription.name);

    if (!providerNames.length) {
      void current.refreshRuntimeData();
      appendLog("INFO", "订阅", "已刷新 Mihomo 运行数据；本地订阅需要先写入 Core 配置后才能由 Provider 更新");
      return;
    }

    void refreshRuntimeProviders(toAppData(current), providerNames)
      .then((snapshot) => applySnapshot(snapshot, true))
      .catch((error) => appendLog("ERROR", "订阅", `订阅 Provider 刷新失败：${String(error)}`));
  },

  addRule: (rule) => {
    set((state) => ({ rules: [rule, ...state.rules] }));
    queuePersist();
  },
  updateRule: (rule) => {
    set((state) => ({ rules: state.rules.map((item) => (item.id === rule.id ? rule : item)) }));
    queuePersist();
  },
  deleteRule: (id) => {
    set((state) => ({ rules: state.rules.filter((item) => item.id !== id) }));
    queuePersist();
  },
  reorderRule: (fromId, toId) => {
    set((state) => {
      const fromIndex = state.rules.findIndex((item) => item.id === fromId);
      const toIndex = state.rules.findIndex((item) => item.id === toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state;
      const rules = [...state.rules];
      const [moved] = rules.splice(fromIndex, 1);
      rules.splice(toIndex, 0, moved);
      return { rules };
    });
    queuePersist();
  },

  closeConnections: (ids) => {
    set((state) => ({
      connections: state.connections.map((connection) =>
        ids.includes(connection.id) ? { ...connection, status: "已关闭" as const } : connection,
      ),
    }));
    queuePersist();

    void closeRuntimeConnections(toAppData(get()), ids)
      .then((snapshot) => applySnapshot(snapshot, true))
      .catch((error) => appendLog("ERROR", "连接", `Mihomo 连接关闭失败：${String(error)}`));
  },
  clearClosedConnections: () => {
    set((state) => ({ connections: state.connections.filter((connection) => connection.status !== "已关闭") }));
    queuePersist();
  },
  clearLogs: () => {
    set({ logs: [] });
    queuePersist();
  },
  updateSetting: (key, value) => {
    set((state) => ({
      settings: { ...state.settings, [key]: value },
      ...(key === "navCollapsed" ? { sidebarCollapsed: Boolean(value) } : {}),
    }));
    queuePersist();
  },
  resetSettings: () => {
    set({ settings: { ...defaultSettings }, themeMode: "light", accent: "#12b8c4", sidebarCollapsed: false });
    queuePersist();
  },
  addOverride: (scope, item) => {
    set((state) => updateOverrideList(state, scope, (items) => [...items, item]));
    queuePersist();
  },
  updateOverride: (scope, item) => {
    set((state) => updateOverrideList(state, scope, (items) => items.map((current) => (current.id === item.id ? item : current))));
    queuePersist();
  },
  deleteOverride: (scope, id) => {
    set((state) => updateOverrideList(state, scope, (items) => items.filter((item) => item.id !== id)));
    queuePersist();
  },
}));
