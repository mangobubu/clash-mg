import type { AppData, ProxyGroup, ProxyNode, RoutingRule } from "../types";

const mergeManagedNodes = (current: ProxyNode[], refreshed: ProxyNode[]) => [
  ...current.filter((node) => node.origin !== "managed"),
  ...refreshed.filter((node) => node.origin === "managed"),
];

const mergeManagedGroups = (current: ProxyGroup[], refreshed: ProxyGroup[]) => [
  ...current.filter((group) => group.origin !== "managed"),
  ...refreshed.filter((group) => group.origin === "managed"),
];

const mergeManagedRules = (current: RoutingRule[], refreshed: RoutingRule[]) => [
  ...current.filter((rule) => rule.source !== "managed"),
  ...refreshed.filter((rule) => rule.source === "managed"),
];

export function mergeRuntimeSnapshot(
  current: AppData,
  refreshed: AppData,
  preserveConcurrentState: boolean,
): AppData {
  return {
    ...current,
    connected: refreshed.connected,
    selectedNodeId: preserveConcurrentState ? current.selectedNodeId : refreshed.selectedNodeId,
    selectedGroupId: preserveConcurrentState ? current.selectedGroupId : refreshed.selectedGroupId,
    nodes: mergeManagedNodes(current.nodes, refreshed.nodes),
    groups: mergeManagedGroups(current.groups, refreshed.groups),
    rules: mergeManagedRules(current.rules, refreshed.rules),
    connections: refreshed.connections,
    logs: preserveConcurrentState ? current.logs : refreshed.logs,
    trafficHistory: refreshed.trafficHistory,
    runtime: refreshed.runtime,
  };
}
