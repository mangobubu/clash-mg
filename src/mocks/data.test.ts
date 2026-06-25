import { describe, expect, it } from "vitest";
import { mockConnections, mockGroups, mockLogs, mockNodes, mockRules, mockSubscriptions } from "./data";

describe("Mock 数据完整性", () => {
  it("所有领域记录都使用唯一标识", () => {
    for (const records of [mockNodes, mockGroups, mockSubscriptions, mockRules, mockConnections, mockLogs]) {
      const ids = records.map((record) => record.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("代理组只引用存在的节点", () => {
    const nodeIds = new Set(mockNodes.map((node) => node.id));
    for (const group of mockGroups) {
      expect(group.nodeIds.every((id) => nodeIds.has(id))).toBe(true);
      expect(!group.currentNodeId || nodeIds.has(group.currentNodeId)).toBe(true);
    }
  });

  it("设计中的核心业务模块均包含演示数据", () => {
    expect(mockNodes.length).toBeGreaterThanOrEqual(8);
    expect(mockSubscriptions.length).toBeGreaterThanOrEqual(5);
    expect(mockRules.length).toBeGreaterThanOrEqual(6);
    expect(mockConnections.length).toBeGreaterThanOrEqual(6);
    expect(mockLogs.length).toBeGreaterThanOrEqual(10);
  });
});
