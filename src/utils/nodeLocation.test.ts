import { describe, expect, it } from "vitest";
import type { ProxyNode } from "../types";
import { getNodeContinent } from "./nodeLocation";

const node = (name: string, overrides: Partial<ProxyNode> = {}): ProxyNode => ({
  id: name,
  name,
  protocol: "ss",
  address: "example.com",
  port: 443,
  latency: 100,
  available: true,
  ...overrides,
});

describe("getNodeContinent", () => {
  it("能根据节点名称识别洲", () => {
    expect(getNodeContinent(node("香港 01"))).toBe("亚洲");
    expect(getNodeContinent(node("Los Angeles Premium"))).toBe("美洲");
  });

  it("优先使用国家代码和旗帜", () => {
    expect(getNodeContinent(node("普通节点", { country: "DE" }))).toBe("欧洲");
    expect(getNodeContinent(node("普通节点", { flag: "🇦🇺" }))).toBe("大洋洲");
  });

  it("无法判断时返回未定位", () => {
    expect(getNodeContinent(node("未知节点"))).toBe("未定位");
  });
});
