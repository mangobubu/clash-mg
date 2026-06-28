import { describe, expect, it } from "vitest";
import type { ProxyNode } from "../types";
import { compareProxyNodesByLatency } from "./nodeLatency";

const node = (name: string, latency: number, available: boolean): ProxyNode => ({
  id: name,
  name,
  protocol: "Vless",
  address: "example.com",
  port: 443,
  latency,
  origin: "managed",
  available,
});

describe("compareProxyNodesByLatency", () => {
  it("按有效延迟升序排列，并将未测速与不可用节点置后", () => {
    const nodes = [
      node("不可用", 0, false),
      node("较慢", 180, true),
      node("未测速", 0, true),
      node("较快", 40, true),
    ];

    expect(nodes.sort(compareProxyNodesByLatency).map((item) => item.name)).toEqual([
      "较快",
      "较慢",
      "未测速",
      "不可用",
    ]);
  });

  it("支持使用界面中的临时延迟参与排序", () => {
    const left = node("左", 200, true);
    const right = node("右", 100, true);
    const displayedLatency = { 左: 50, 右: 120 };

    expect(compareProxyNodesByLatency(left, right, (item) => displayedLatency[item.name as "左" | "右"])).toBeLessThan(0);
  });
});
