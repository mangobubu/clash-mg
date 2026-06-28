import { describe, expect, it } from "vitest";
import type { ProxyGroup } from "../types";
import {
  getRulePolicyNames,
  getSelectableProxyGroupMembers,
  isHiddenBuiltinProxyGroup,
  referencesProxyGroup,
} from "./proxyGroups";

const group = (
  id: string,
  name: string,
  groupIds: string[] = [],
): ProxyGroup => ({
  id,
  name,
  type: "Selector",
  origin: "managed",
  icon: "",
  description: "",
  nodeIds: [],
  groupIds,
  autoTest: false,
  allowManual: true,
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
