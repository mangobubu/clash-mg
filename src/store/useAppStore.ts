import { create } from "zustand";
import { message } from "antd";
import {
  closeRuntimeConnections,
  deleteLocalSubscription,
  loadAppSnapshot,
  refreshLocalSubscriptions,
  refreshRuntimeConnections,
  refreshRuntimeSnapshot,
  saveAppSnapshot,
  selectRuntimeProxy,
  testRuntimeProxyDelay,
} from "../backend/api";
import { createEmptyAppData, defaultSettings } from "../defaults/appDefaults";
import type { AppData, AppState, DelayResult, OverrideItem, Subscription, SubscriptionRefreshResult } from "../types";
import { appendTrafficHistorySample } from "../utils/trafficHistory";
import { mergeRuntimeSnapshot } from "./runtimeSnapshot";

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
let connectionRefreshRevision = 0;
let runtimeRefreshRevision = 0;
let stateRevision = 0;
let persistenceReady = false;
let persistenceChain: Promise<void> = Promise.resolve();
const closingConnectionIds = new Set<string>();
const isStandaloneAppWindow = () => /^#\/(?:connections-window|connection-detail\/)/.test(window.location.hash);

const themeSettingByMode = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
} as const;

const themeModeBySetting = {
  浅色: "light",
  深色: "dark",
  跟随系统: "system",
} as const;

const dnsStrategySettings = {
  "使用内核 (Fake-IP)": { dnsEnabled: true, enhancedMode: "Fake-IP" },
  "使用系统 DNS": { dnsEnabled: false, enhancedMode: "关闭" },
  "Redir-Host": { dnsEnabled: true, enhancedMode: "Redir-Host" },
} as const;

const dnsStrategyByEnhancedMode = {
  "Fake-IP": "使用内核 (Fake-IP)",
  "Redir-Host": "Redir-Host",
  "关闭": "使用系统 DNS",
} as const;

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
  nodeDialerOverrides: state.nodeDialerOverrides,
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

const persistSnapshotNow = async () => {
  if (!persistenceReady) throw new Error("应用数据尚未成功加载，已阻止覆盖本地状态文件");
  try {
    await saveAppSnapshot(toAppData(useAppStore.getState()));
  } catch (error) {
    console.error("应用状态保存失败", error);
    try {
      const { data, backendAvailable } = await loadAppSnapshot();
      applySnapshot(data, backendAvailable);
      appendLog("ERROR", "运行配置", `设置应用失败，已恢复上次有效配置：${String(error)}`);
      message.error({ content: `设置应用失败：${String(error)}`, duration: 6 });
    } catch (reloadError) {
      console.error("恢复上次有效配置失败", reloadError);
    }
    throw error;
  }
};

const persistCurrentState = () => {
  const operation = persistenceChain
    .catch(() => undefined)
    .then(() => persistSnapshotNow());
  persistenceChain = operation;
  return operation;
};

const flushPendingPersistence = async () => {
  if (isStandaloneAppWindow()) return;
  window.clearTimeout(persistTimer);
  persistTimer = undefined;
  await persistCurrentState();
};

const queuePersist = () => {
  stateRevision += 1;
  if (!persistenceReady || isStandaloneAppWindow()) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    void persistCurrentState().catch(() => undefined);
  }, 120);
};

const applySnapshot = (snapshot: AppData, backendAvailable = true) => {
  const nodeDialerOverrides = snapshot.nodeDialerOverrides ?? [];
  useAppStore.setState({
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      const override = nodeDialerOverrides.find((item) =>
        item.targetNodeId === node.id || item.targetNodeName === node.name);
      return override
        ? { ...node, dialerProxy: override.dialerProxy ?? undefined }
        : node;
    }),
    groups: snapshot.groups.map((group) => ({
      ...group,
      groupIds: group.groupIds ?? [],
      testUrl: group.testUrl ?? "https://www.gstatic.com/generate_204",
      interval: group.interval ?? 300,
      tolerance: group.tolerance ?? 50,
      loadBalanceStrategy: group.loadBalanceStrategy ?? "round-robin",
      healthCheck: group.healthCheck ?? true,
      failureThreshold: group.failureThreshold ?? 3,
      extra: group.extra ?? "",
    })),
    proxyGroupOverrides: snapshot.proxyGroupOverrides ?? [],
    nodeDialerOverrides,
    connections: snapshot.connections
      .filter((connection) => !closingConnectionIds.has(connection.id))
      .map((connection) => ({
        ...connection,
        uploadBytes: connection.uploadBytes ?? 0,
        downloadBytes: connection.downloadBytes ?? 0,
        node: connection.node ?? connection.policy,
        chain: connection.chain ?? [connection.policy],
      })),
    ruleOverrides: snapshot.ruleOverrides ?? [],
    subscriptions: snapshot.subscriptions
      .filter((subscription) => !isRuntimeProviderRecord(subscription))
      .map((subscription) => ({
        ...subscription,
        headers: subscription.headers ?? {},
        healthCheck: subscription.healthCheck ?? true,
        testUrl: subscription.testUrl ?? "https://www.gstatic.com/generate_204",
      })),
    hydrated: true,
    backendAvailable,
  });
};

const applyCommittedSnapshot = (snapshot: AppData, backendAvailable = true) => {
  stateRevision += 1;
  applySnapshot(snapshot, backendAvailable);
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
      persistenceReady = true;
      applySnapshot(data, backendAvailable);
    } catch (error) {
      console.error(error);
      persistenceReady = false;
      set({ ...createEmptyAppData(), hydrated: true, backendAvailable: false });
      message.error({ content: `应用数据加载失败，已阻止空状态覆盖原文件：${String(error)}`, duration: 8 });
    }
  },

  refreshRuntimeData: async () => {
    const requestRuntimeRevision = ++runtimeRefreshRevision;
    const requestStateRevision = stateRevision;
    const requestRevision = connectionRefreshRevision;
    try {
      const snapshot = await refreshRuntimeSnapshot(toAppData(get()));
      if (requestRuntimeRevision !== runtimeRefreshRevision) return;
      const current = toAppData(get());
      const merged = mergeRuntimeSnapshot(
        current,
        snapshot,
        requestStateRevision !== stateRevision,
      );
      applySnapshot({
        ...merged,
        connections: requestRevision === connectionRefreshRevision
          ? merged.connections
          : get().connections,
      }, true);
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
  refreshConnections: async () => {
    const requestRevision = connectionRefreshRevision;
    try {
      const result = await refreshRuntimeConnections(toAppData(get()));
      if (requestRevision !== connectionRefreshRevision) return;
      set((current) => {
        const connections = result.connections.filter((connection) => !closingConnectionIds.has(connection.id));

        return {
          connections,
          trafficHistory: appendTrafficHistorySample(current.trafficHistory, {
            connections,
            groups: current.groups,
            downloadTotal: result.downloadTotal,
            uploadTotal: result.uploadTotal,
          }),
          runtime: {
            ...current.runtime,
            controllerConnected: true,
            uploadTotal: result.uploadTotal,
            downloadTotal: result.downloadTotal,
            lastSync: currentTime(),
            error: undefined,
          },
          connected: true,
        };
      });
    } catch (error) {
      console.error("连接列表自动刷新失败", error);
      set((state) => ({
        runtime: {
          ...state.runtime,
          controllerConnected: false,
          error: String(error),
          lastSync: currentTime(),
        },
        connected: false,
      }));
    }
  },

  setThemeMode: (themeMode) => {
    set((state) => ({
      themeMode,
      settings: {
        ...state.settings,
        uiTheme: themeSettingByMode[themeMode],
      },
    }));
    queuePersist();
  },
  setAccent: (accent) => {
    set({ accent });
    queuePersist();
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set((state) => ({
      sidebarCollapsed,
      settings: {
        ...state.settings,
        navCollapsed: sidebarCollapsed,
      },
    }));
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
  selectProxy: async (proxyId, groupId) => {
    await flushPendingPersistence();
    const initial = get();
    const targetGroupId = groupId ?? initial.selectedGroupId;
    const targetGroup = initial.groups.find((group) => group.id === targetGroupId);
    if (targetGroup && !targetGroup.allowManual) {
      appendLog("WARNING", "代理", `代理组“${targetGroup.name}”由 Mihomo 自动管理，已忽略手动切换`);
      await get().refreshRuntimeData();
      return;
    }

    set((state) => {
      const node = state.nodes.find((item) => item.id === proxyId);
      const nestedGroup = state.groups.find((item) => item.id === proxyId);
      const selectedProxy = node ?? nestedGroup;
      if (!selectedProxy) return state;
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

    const current = get();
    const group = current.groups.find((item) => item.id === (groupId ?? current.selectedGroupId));
    const selectedProxy = current.nodes.find((item) => item.id === proxyId)
      ?? current.groups.find((item) => item.id === proxyId);
    if (group && selectedProxy) {
      try {
        const snapshot = await selectRuntimeProxy(toAppData(current), group.name, selectedProxy.name);
        applyCommittedSnapshot(snapshot, current.backendAvailable);
        if (!current.backendAvailable) await saveAppSnapshot(snapshot);
      } catch (error) {
        appendLog("ERROR", "代理", `Mihomo 代理切换失败：${String(error)}`);
        await get().refreshRuntimeData();
      }
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
  setNodeDialerOverride: async (targetNode, dialerProxy) => {
    window.clearTimeout(persistTimer);
    persistTimer = undefined;
    set((state) => ({
      nodeDialerOverrides: [
        ...state.nodeDialerOverrides.filter((item) =>
          item.targetNodeId !== targetNode.id && item.targetNodeName !== targetNode.name),
        {
          targetNodeId: targetNode.id,
          targetNodeName: targetNode.name,
          dialerProxy: dialerProxy ?? null,
        },
      ],
      nodes: state.nodes.map((node) =>
        node.id === targetNode.id ? { ...node, dialerProxy } : node),
    }));
    await persistCurrentState();
  },
  updateNodeLatency: (nodeId, latency, available) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, latency, available: available ?? node.available } : node,
      ),
    }));
  },
  testNodeLatency: async (nodeId): Promise<DelayResult> => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return { latency: 0, available: false, message: "节点不存在" };

    let result: DelayResult;
    try {
      result = await testRuntimeProxyDelay(get().settings, node.name);
    } catch (error) {
      result = { latency: 0, available: false, message: String(error) };
    }
    get().updateNodeLatency(nodeId, result.latency, result.available);
    return result;
  },
  testAutoProxyGroups: async () => {
    const automaticGroups = get().groups.filter((group) => group.type === "URL-Test" && group.autoTest);
    const nodeIds = [...new Set(automaticGroups.flatMap((group) => group.nodeIds))];
    if (!automaticGroups.length || !nodeIds.length) return;

    await Promise.all(nodeIds.map((nodeId) => get().testNodeLatency(nodeId)));
    await get().refreshRuntimeData();
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
    await flushPendingPersistence();
    const snapshot = await deleteLocalSubscription(toAppData(get()), id);
    applyCommittedSnapshot(snapshot, get().backendAvailable);
  },
  refreshSubscriptions: async (ids) => {
    await flushPendingPersistence();
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
      applyCommittedSnapshot(refreshed.snapshot, get().backendAvailable);
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

  closeConnections: async (ids) => {
    const uniqueIds = [...new Set(ids)].filter((id) => !closingConnectionIds.has(id));
    if (!uniqueIds.length) return;
    await flushPendingPersistence();
    const previousConnections = get().connections;

    connectionRefreshRevision += 1;
    uniqueIds.forEach((id) => closingConnectionIds.add(id));
    set((state) => ({
      connections: state.connections.map((connection) =>
        uniqueIds.includes(connection.id) ? { ...connection, status: "已关闭" as const } : connection,
      ),
    }));

    try {
      const snapshot = await closeRuntimeConnections(toAppData(get()), uniqueIds);
      connectionRefreshRevision += 1;
      applyCommittedSnapshot(snapshot, true);
    } catch (error) {
      connectionRefreshRevision += 1;
      uniqueIds.forEach((id) => closingConnectionIds.delete(id));
      set((state) => ({
        connections: state.connections.map((connection) =>
          uniqueIds.includes(connection.id)
            ? previousConnections.find((previous) => previous.id === connection.id) ?? connection
            : connection,
        ),
      }));
      appendLog("ERROR", "连接", `Mihomo 连接关闭失败：${String(error)}`);
      await get().refreshConnections();
      throw error;
    } finally {
      uniqueIds.forEach((id) => closingConnectionIds.delete(id));
    }
  },
  clearClosedConnections: () => {
    set((state) => ({ connections: state.connections.filter((connection) => connection.status !== "已关闭") }));
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
        ...(key === "minimizeOnClose" ? { minimizeToTray: value } : {}),
        ...(key === "minimizeToTray" ? { minimizeOnClose: value } : {}),
        ...(key === "showTrayIcon" && value === false ? { minimizeOnClose: false, minimizeToTray: false, silentLaunch: false } : {}),
        ...(key === "bypassChina" ? { bypassMainland: value } : {}),
        ...(key === "bypassMainland" ? { bypassChina: value } : {}),
        ...(key === "uiTheme" && typeof value === "string" && value in themeModeBySetting ? { uiTheme: value } : {}),
        ...(key === "dnsStrategy" && typeof value === "string" && value in dnsStrategySettings ? dnsStrategySettings[value as keyof typeof dnsStrategySettings] : {}),
        ...(key === "enhancedMode" && typeof value === "string" && value in dnsStrategyByEnhancedMode ? { dnsStrategy: dnsStrategyByEnhancedMode[value as keyof typeof dnsStrategyByEnhancedMode], dnsEnabled: value !== "关闭" } : {}),
      },
      ...(key === "uiTheme" && typeof value === "string" && value in themeModeBySetting ? { themeMode: themeModeBySetting[value as keyof typeof themeModeBySetting] } : {}),
      ...(key === "navCollapsed" ? { sidebarCollapsed: Boolean(value) } : {}),
    }));
    queuePersist();
  },
  saveSettings: async () => {
    await flushPendingPersistence();
  },
  applyTunMode: async (enabled) => {
    const current = get();
    const previousEnabled = Boolean(current.settings.tunMode);
    if (previousEnabled === enabled) return;

    window.clearTimeout(persistTimer);
    persistTimer = undefined;
    await persistenceChain.catch(() => undefined);
    
    const latest = get();
    const nextSettings = { ...latest.settings, tunMode: enabled };
    const nextSnapshot = toAppData({ ...latest, settings: nextSettings });

    try {
      await saveAppSnapshot(nextSnapshot);
      set((state) => ({
        settings: { ...state.settings, tunMode: enabled },
        runtime: { ...state.runtime, tunEnabled: enabled },
      }));
      appendLog("SUCCESS", "TUN", `TUN 模式已${enabled ? "开启" : "关闭"}`);
    } catch (error) {
      appendLog("ERROR", "TUN", `TUN ${enabled ? "开启" : "关闭"}失败：${String(error)}`);
      throw error;
    }
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
