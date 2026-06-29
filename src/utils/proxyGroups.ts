import type { ProxyGroup, ProxyNode } from "../types";

const hiddenBuiltinProxyGroupNames = new Set(["DIRECT", "GLOBAL", "REJECT"]);

export const isHiddenBuiltinProxyGroup = (group: ProxyGroup) =>
  hiddenBuiltinProxyGroupNames.has(group.name.toUpperCase());

export const isGlobalProxyGroup = (group: ProxyGroup) =>
  group.name.toUpperCase() === "GLOBAL";

export const isDirectOrRejectProxyGroup = (group: ProxyGroup) =>
  group.name.toUpperCase() === "DIRECT" || group.name.toUpperCase() === "REJECT";

export const referencesProxyGroup = (
  groups: ProxyGroup[],
  sourceGroupId: string,
  targetGroupId: string,
) => {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const pending = [sourceGroupId];
  const visited = new Set<string>();

  while (pending.length) {
    const groupId = pending.pop();
    if (!groupId || visited.has(groupId)) continue;
    if (groupId === targetGroupId) return true;

    visited.add(groupId);
    pending.push(...(groupById.get(groupId)?.groupIds ?? []));
  }

  return false;
};

export const getSelectableProxyGroupMembers = (
  groups: ProxyGroup[],
  editingGroupId?: string,
) => groups.filter((group) =>
  !isGlobalProxyGroup(group)
  && group.id !== editingGroupId
  && (!editingGroupId || !referencesProxyGroup(groups, group.id, editingGroupId)));

export const resolveProxyGroupCurrentNode = (
  group: ProxyGroup,
  groups: ProxyGroup[],
  nodes: ProxyNode[],
) => {
  const groupById = new Map(groups.map((item) => [item.id, item]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visitedGroupIds = new Set([group.id]);
  let currentId = group.currentNodeId;

  while (currentId) {
    const currentNode = nodeById.get(currentId);
    if (currentNode) return currentNode;
    if (visitedGroupIds.has(currentId)) return undefined;

    visitedGroupIds.add(currentId);
    currentId = groupById.get(currentId)?.currentNodeId;
  }

  return undefined;
};

export const getRulePolicyNames = (groups: ProxyGroup[]) => {
  const names = groups
    .filter((group) => !isHiddenBuiltinProxyGroup(group))
    .map((group) => group.name);

  return [...new Set([...names, "DIRECT", "REJECT"])];
};
