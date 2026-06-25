import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  initialSettings,
  mockActivities,
  mockConnections,
  mockDomainOverrides,
  mockGroups,
  mockLogs,
  mockNodes,
  mockRequestOverrides,
  mockResponseOverrides,
  mockRules,
  mockSubscriptions,
} from "../mocks/data";
import type { AppState, OverrideItem } from "../types";

const currentTime = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

type OverrideScope = "domain" | "request" | "response";
type OverrideKey = "domainOverrides" | "requestOverrides" | "responseOverrides";

const overrideKeyByScope: Record<OverrideScope, OverrideKey> = {
  domain: "domainOverrides",
  request: "requestOverrides",
  response: "responseOverrides",
};

const updateOverrideList = (
  state: AppState,
  scope: OverrideScope,
  updater: (items: OverrideItem[]) => OverrideItem[],
) => {
  const key = overrideKeyByScope[scope];
  return { [key]: updater(state[key]) } as Pick<AppState, OverrideKey>;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      themeMode: "light",
      accent: "#12b8c4",
      sidebarCollapsed: false,
      connected: true,
      selectedNodeId: "hk-01",
      selectedGroupId: "manual",
      nodes: mockNodes,
      groups: mockGroups,
      subscriptions: mockSubscriptions,
      rules: mockRules,
      connections: mockConnections,
      logs: mockLogs,
      activities: mockActivities,
      settings: initialSettings,
      domainOverrides: mockDomainOverrides,
      requestOverrides: mockRequestOverrides,
      responseOverrides: mockResponseOverrides,

      setThemeMode: (themeMode) => set({ themeMode }),
      setAccent: (accent) => set({ accent }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setConnected: (connected) =>
        set((state) => ({
          connected,
          activities: [
            {
              id: crypto.randomUUID(),
              time: currentTime(),
              kind: connected ? "power" : "switch",
              content: connected ? "已启动网络连接" : "已暂停网络连接",
            },
            ...state.activities,
          ],
        })),
      selectNode: (nodeId, groupId) =>
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
        }),
      selectGroup: (selectedGroupId) => set({ selectedGroupId }),
      addNode: (node) => set((state) => ({ nodes: [node, ...state.nodes] })),
      addGroup: (group) => set((state) => ({ groups: [...state.groups, group] })),
      refreshLatencies: () =>
        set((state) => ({
          nodes: state.nodes.map((node) => ({
            ...node,
            latency: Math.max(18, node.latency + Math.round(Math.random() * 30 - 15)),
          })),
        })),

      addSubscription: (subscription) =>
        set((state) => ({
          subscriptions: [subscription, ...state.subscriptions],
          logs: [{ id: crypto.randomUUID(), time: currentTime(), level: "SUCCESS", source: "订阅", content: `已添加订阅“${subscription.name}”` }, ...state.logs],
        })),
      updateSubscription: (subscription) =>
        set((state) => ({ subscriptions: state.subscriptions.map((item) => (item.id === subscription.id ? subscription : item)) })),
      deleteSubscription: (id) =>
        set((state) => ({ subscriptions: state.subscriptions.filter((item) => item.id !== id) })),
      refreshSubscriptions: (ids) =>
        set((state) => ({
          subscriptions: state.subscriptions.map((subscription) =>
            !ids || ids.includes(subscription.id)
              ? { ...subscription, lastUpdated: "刚刚", status: "正常" as const }
              : subscription,
          ),
          logs: [{ id: crypto.randomUUID(), time: currentTime(), level: "SUCCESS", source: "订阅", content: `订阅更新完成，共 ${ids?.length ?? state.subscriptions.length} 项` }, ...state.logs],
        })),

      addRule: (rule) => set((state) => ({ rules: [rule, ...state.rules] })),
      updateRule: (rule) => set((state) => ({ rules: state.rules.map((item) => (item.id === rule.id ? rule : item)) })),
      deleteRule: (id) => set((state) => ({ rules: state.rules.filter((item) => item.id !== id) })),
      reorderRule: (fromId, toId) =>
        set((state) => {
          const fromIndex = state.rules.findIndex((item) => item.id === fromId);
          const toIndex = state.rules.findIndex((item) => item.id === toId);
          if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state;
          const rules = [...state.rules];
          const [moved] = rules.splice(fromIndex, 1);
          rules.splice(toIndex, 0, moved);
          return { rules };
        }),

      closeConnections: (ids) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            ids.includes(connection.id) ? { ...connection, status: "已关闭" as const } : connection,
          ),
        })),
      clearClosedConnections: () =>
        set((state) => ({ connections: state.connections.filter((connection) => connection.status !== "已关闭") })),
      clearLogs: () => set({ logs: [] }),
      updateSetting: (key, value) =>
        set((state) => ({
          settings: { ...state.settings, [key]: value },
          ...(key === "navCollapsed" ? { sidebarCollapsed: Boolean(value) } : {}),
        })),
      resetSettings: () => set({ settings: { ...initialSettings }, themeMode: "light", accent: "#12b8c4", sidebarCollapsed: false }),
      addOverride: (scope, item) => set((state) => updateOverrideList(state, scope, (items) => [...items, item])),
      updateOverride: (scope, item) => set((state) => updateOverrideList(state, scope, (items) => items.map((current) => (current.id === item.id ? item : current)))),
      deleteOverride: (scope, id) => set((state) => updateOverrideList(state, scope, (items) => items.filter((item) => item.id !== id))),
    }),
    {
      name: "clash-mg-prototype-state",
      version: 1,
    },
  ),
);
