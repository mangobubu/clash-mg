import { describe, expect, it } from "vitest";
import { createEmptyAppData } from "../defaults/appDefaults";
import type { AppData, ProxyGroup, ProxyNode, RoutingRule, Subscription } from "../types";
import { mergeRuntimeSnapshot } from "./runtimeSnapshot";

const subscription = (id: string): Subscription => ({
  id,
  name: id,
  type: "HTTP",
  url: `https://example.com/${id}`,
  nodeCount: 0,
  lastUpdated: "尚未更新",
  updateInterval: 12,
  status: "正常",
  enabled: true,
  autoUpdate: true,
  proxyUpdate: true,
  allowOverride: false,
  headers: {},
  healthCheck: true,
  testUrl: "https://www.gstatic.com/generate_204",
  usedTraffic: "0 B",
  expiresAt: "未知",
  tags: [],
});

const node = (id: string, origin: "local" | "managed"): ProxyNode => ({
  id,
  name: id,
  protocol: "HTTP",
  address: "127.0.0.1",
  port: 8080,
  latency: 0,
  origin,
  available: true,
});

const group = (id: string, origin: "local" | "managed"): ProxyGroup => ({
  id,
  name: id,
  type: "Selector",
  origin,
  icon: "",
  description: "",
  nodeIds: [],
  groupIds: [],
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

const rule = (id: string, source: "local" | "managed"): RoutingRule => ({
  id,
  type: "DOMAIN",
  content: `${id}.example.com`,
  policy: "DIRECT",
  source,
  enabled: true,
  noResolve: false,
  wildcard: false,
});

const data = (): AppData => createEmptyAppData();

describe("mergeRuntimeSnapshot", () => {
  it("运行时刷新始终保留最新订阅、设置和本地配置", () => {
    const current = data();
    current.subscriptions = [subscription("latest")];
    current.settings = { ...current.settings, mixedPort: 17890 };
    current.nodes = [node("local-latest", "local"), node("managed-old", "managed")];
    current.groups = [group("local-latest", "local"), group("managed-old", "managed")];
    current.rules = [rule("local-latest", "local"), rule("managed-old", "managed")];

    const refreshed = data();
    refreshed.nodes = [node("managed-new", "managed")];
    refreshed.groups = [group("managed-new", "managed")];
    refreshed.rules = [rule("managed-new", "managed")];
    refreshed.runtime = { ...refreshed.runtime, controllerConnected: true };

    const merged = mergeRuntimeSnapshot(current, refreshed, false);

    expect(merged.subscriptions).toEqual(current.subscriptions);
    expect(merged.settings).toEqual(current.settings);
    expect(merged.nodes.map((item) => item.id)).toEqual(["local-latest", "managed-new"]);
    expect(merged.groups.map((item) => item.id)).toEqual(["local-latest", "managed-new"]);
    expect(merged.rules.map((item) => item.id)).toEqual(["local-latest", "managed-new"]);
    expect(merged.runtime.controllerConnected).toBe(true);
  });

  it("请求期间发生状态修改时不恢复已清空日志和旧选择", () => {
    const current = data();
    current.logs = [];
    current.selectedNodeId = "latest-node";
    current.selectedGroupId = "latest-group";

    const refreshed = data();
    refreshed.logs = [{ id: "stale", time: "12:00:00", level: "INFO", source: "测试", content: "旧日志" }];
    refreshed.selectedNodeId = "stale-node";
    refreshed.selectedGroupId = "stale-group";

    const merged = mergeRuntimeSnapshot(current, refreshed, true);

    expect(merged.logs).toEqual([]);
    expect(merged.selectedNodeId).toBe("latest-node");
    expect(merged.selectedGroupId).toBe("latest-group");
  });
});
