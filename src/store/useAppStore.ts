import { create } from "zustand";
import { message } from "antd";
import {
  closeRuntimeConnections,
  deleteLocalSubscription,
  loadAppSnapshot,
  refreshLocalSubscriptions,
  refreshRuntimeSnapshot,
  saveAppSnapshot,
  selectRuntimeProxy,
  testRuntimeProxyDelay,
} from "../backend/api";
import { createEmptyAppData, defaultSettings } from "../defaults/appDefaults";
import type { AppData, AppState, DelayResult, OverrideItem, Subscription, SubscriptionRefreshResult } from "../types";

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

const isRuntimeProviderRecord = (subscription: Subscription) =>
  subscription.description === "来自 Mihomo Proxy Provider" && subscription.tags.includes("Provider");

const createSubscriptionRefreshResult = (): SubscriptionRefreshResult => ({
  updated: 0,
  failed: 0,
  skipped: 0,
  localUpdated: 0,
  providerUpdated: 0,
  messages: [],
});

const toAppData = (state: AppState): AppData => ({
  themeMode: state.themeMode,
  accent: state.accent,
  sidebarCollapsed: state.sidebarCollapsed,
  connected: state.connected,
  selectedNodeId: state.selectedNodeId,
  selectedGroupId: state.selectedGroupId,
  nodes: state.nodes,
  groups: state.groups,
  proxyGroupOverrides: state.proxyGroupOverrides,
  subscriptions: state.subscriptions,
  rules: state.rules,
  ruleOverrides: state.ruleOverrides,
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
      void loadAppSnapshot()
        .then(({ data, backendAvailable }) => {
          applySnapshot(data, backendAvailable);
          appendLog("ERROR", "运行配置", `设置应用失败，已恢复上次有效配置：${String(error)}`);
          message.error({ content: `设置应用失败：${String(error)}`, duration: 6 });
        })
        .catch((reloadError) => {
          console.error("恢复上次有效配置失败", reloadError);
        });
    });
  }, 120);
};

const applySnapshot = (snapshot: AppData, backendAvailable = true) => {
  useAppStore.setState({
    ...snapshot,
    groups: snapshot.groups.map((group) => ({ ...group, groupIds: group.groupIds ?? [] })),
    proxyGroupOverrides: snapshot.proxyGroupOverrides ?? [],
    connections: snapshot.connections.map((connection) => ({
      ...connection,
      node: connection.node ?? connection.policy,
      chain: connection.chain ?? [connection.policy],
    })),
    ruleOverrides: snapshot.ruleOverrides ?? [],
    subscriptions: snapshot.subscriptions.filter((subscription) => !isRuntimeProviderRecord(subscription)),
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
  selectProxy: (proxyId, groupId) => {
    set((state) => {
      const node = state.nodes.find((item) => item.id === proxyId);
      const nestedGroup = state.groups.find((item) => item.id === proxyId);
      const selectedProxy = node ?? nestedGroup;
      if (!selectedProxy) return state;
      const targetGroupId = groupId ?? state.selectedGroupId;
      const targetLabel = node ? "节点" : "代理组";
      return {
        selectedNodeId: node ? node.id : state.selectedNodeId,
        groups: state.groups.map((group) =>
          group.id === targetGroupId ? { ...group, currentNodeId: proxyId } : group,
        ),
        logs: [
          { id: crypto.randomUUID(), time: currentTime(), level: "SUCCESS", source: "代理", content: `已切换至${targetLabel}“${selectedProxy.name}”` },
          ...state.logs,
        ],
        activities: [
          { id: crypto.randomUUID(), time: currentTime(), kind: "switch", content: `切换至${targetLabel} ${selectedProxy.name}` },
          ...state.activities,
        ],
      };
    });
    queuePersist();

    const current = get();
    const group = current.groups.find((item) => item.id === (groupId ?? current.selectedGroupId));
    const selectedProxy = current.nodes.find((item) => item.id === proxyId)
      ?? current.groups.find((item) => item.id === proxyId);
    if (group && selectedProxy) {
      void selectRuntimeProxy(toAppData(current), group.name, selectedProxy.name)
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
  setProxyGroupOverride: (targetGroup, addedGroupIds) => {
    set((state) => {
      const previousOverride = state.proxyGroupOverrides.find(
        (item) => item.targetGroupId === targetGroup.id,
      );
      const previousAddedIds = new Set(previousOverride?.addedGroupIds ?? []);
      const nextOverrides = state.proxyGroupOverrides.filter(
        (item) => item.targetGroupId !== targetGroup.id,
      );
      if (addedGroupIds.length) {
        nextOverrides.push({
          targetGroupId: targetGroup.id,
          targetGroupName: targetGroup.name,
          addedGroupIds,
        });
      }

      return {
        proxyGroupOverrides: nextOverrides,
        groups: state.groups.map((group) => {
          if (group.id !== targetGroup.id) return group;
          const baseGroupIds = group.groupIds.filter((id) => !previousAddedIds.has(id));
          const groupIds = [...new Set([...baseGroupIds, ...addedGroupIds])];
          const validCurrentIds = new Set([...group.nodeIds, ...groupIds]);
          return {
            ...group,
            groupIds,
            currentNodeId: group.currentNodeId && validCurrentIds.has(group.currentNodeId)
              ? group.currentNodeId
              : group.nodeIds[0] ?? groupIds[0],
          };
        }),
      };
    });
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
  deleteSubscription: async (id) => {
    window.clearTimeout(persistTimer);
    const snapshot = await deleteLocalSubscription(toAppData(get()), id);
    applySnapshot(snapshot, get().backendAvailable);
  },
  refreshSubscriptions: async (ids) => {
    const current = get();
    const targets = current.subscriptions.filter((subscription) => !ids || ids.includes(subscription.id));
    const result = createSubscriptionRefreshResult();

    if (!targets.length) {
      appendLog("WARNING", "订阅", "没有找到可刷新的订阅");
      result.skipped = ids?.length ?? 0;
      result.messages.push("没有找到可刷新的订阅");
      return result;
    }

    try {
      const refreshed = await refreshLocalSubscriptions(toAppData(current), targets.map((subscription) => subscription.id));
      applySnapshot(refreshed.snapshot, get().backendAvailable);
      result.localUpdated = refreshed.updated;
      result.updated = refreshed.updated;
      result.failed = refreshed.failed;
      result.skipped = refreshed.skipped;
      result.messages.push(...refreshed.messages);
    } catch (error) {
      const message = `订阅更新失败：${String(error)}`;
      appendLog("ERROR", "订阅", message);
      result.failed = targets.length;
      result.messages.push(message);
    }

    return result;
  },

  addRule: (rule) => {
    set((state) => ({ rules: [rule, ...state.rules] }));
    queuePersist();
  },
  updateRule: (rule) => {
    set((state) => ({ rules: state.rules.map((item) => (item.id === rule.id ? rule : item)) }));
    queuePersist();
  },
  setRuleOverride: (targetRule, overrideRule) => {
    set((state) => ({
      ruleOverrides: [
        ...state.ruleOverrides.filter((item) =>
          item.targetType !== targetRule.type || item.targetContent !== targetRule.content),
        {
          targetType: targetRule.type,
          targetContent: targetRule.content,
          policy: overrideRule.policy,
          enabled: overrideRule.enabled,
          noResolve: overrideRule.noResolve,
          note: overrideRule.note,
        },
      ],
      rules: state.rules.map((item) => item.id === targetRule.id ? {
        ...item,
        policy: overrideRule.policy,
        enabled: overrideRule.enabled,
        noResolve: overrideRule.noResolve,
        note: overrideRule.note,
      } : item),
    }));
    queuePersist();
  },
  clearRuleOverride: (targetRule) => {
    set((state) => ({
      ruleOverrides: state.ruleOverrides.filter((item) =>
        item.targetType !== targetRule.type || item.targetContent !== targetRule.content),
    }));
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
      settings: {
        ...state.settings,
        [key]: value,
        ...(key === "proxyMode" ? { coreMode: value } : {}),
        ...(key === "coreMode" ? { proxyMode: value } : {}),
      },
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
