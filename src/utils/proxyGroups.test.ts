import { describe, expect, it } from "vitest";
import type { ProxyGroup, ProxyNode } from "../types";
import {
  getRulePolicyNames,
  getSelectableProxyGroupMembers,
  isHiddenBuiltinProxyGroup,
  referencesProxyGroup,
  resolveProxyGroupCurrentNode,
} from "./proxyGroups";

const group = (
  id: string,
  name: string,
  groupIds: string[] = [],
  currentNodeId?: string,
): ProxyGroup => ({
  id,
  name,
  type: "Selector",
  origin: "managed",
  icon: "",
  description: "",
  nodeIds: [],
  groupIds,
  currentNodeId,
  autoTest: false,
  allowManual: true,
  testUrl: "https://www.gstatic.com/generate_204",
  interval: 300,
  tolerance: 50,
  loadBalanceStrategy: "round-robin",
  healthCheck: true,
  failureThreshold: 3,
  extra: "",
});

const node = (id: string, latency: number): ProxyNode => ({
  id,
  name: id,
  protocol: "Vless",
  address: "example.com",
  port: 443,
  latency,
  origin: "managed",
  available: true,
});

describe("代理组展示与引用规则", () => {
  it("隐藏 Mihomo 内置项，并从规则策略中排除 GLOBAL", () => {
    const groups = [
      group("direct", "DIRECT"),
      group("global", "GLOBAL"),
      group("reject", "REJECT"),
      group("custom", "节点选择"),
    ];

    expect(groups.filter(isHiddenBuiltinProxyGroup).map((item) => item.name)).toEqual([
      "DIRECT",
      "GLOBAL",
      "REJECT",
    ]);
    expect(getRulePolicyNames(groups)).toEqual(["节点选择", "DIRECT", "REJECT"]);
  });

  it("代理组成员排除 GLOBAL、自身和会形成循环引用的代理组", () => {
    const groups = [
      group("global", "GLOBAL"),
      group("direct", "DIRECT"),
      group("parent", "父级", ["editing"]),
      group("editing", "正在编辑"),
      group("sibling", "同级"),
    ];

    expect(referencesProxyGroup(groups, "parent", "editing")).toBe(true);
    expect(getSelectableProxyGroupMembers(groups, "editing").map((item) => item.name)).toEqual([
      "DIRECT",
      "同级",
    ]);
  });
});

describe("代理组当前节点解析", () => {
  it("支持直接节点和多层代理组引用", () => {
    const targetNode = node("香港节点", 28);
    const directGroup = group("direct-group", "直接选择", [], targetNode.id);
    const leafGroup = group("leaf", "自动选择", [], targetNode.id);
    const middleGroup = group("middle", "节点选择", [leafGroup.id], leafGroup.id);
    const rootGroup = group("root", "流媒体", [middleGroup.id], middleGroup.id);
    const groups = [directGroup, leafGroup, middleGroup, rootGroup];

    expect(resolveProxyGroupCurrentNode(directGroup, groups, [targetNode])).toBe(targetNode);
    expect(resolveProxyGroupCurrentNode(rootGroup, groups, [targetNode])).toBe(targetNode);
  });

  it("循环引用或无最终节点时安全返回 undefined", () => {
    const first = group("first", "第一组", ["second"], "second");
    const second = group("second", "第二组", ["first"], "first");
    const missing = group("missing", "缺失节点", [], "unknown");
    const groups = [first, second, missing];

    expect(resolveProxyGroupCurrentNode(first, groups, [])).toBeUndefined();
    expect(resolveProxyGroupCurrentNode(missing, groups, [])).toBeUndefined();
  });
});
