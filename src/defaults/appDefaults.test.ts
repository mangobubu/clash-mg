import { describe, expect, it } from "vitest";
import { createEmptyAppData, defaultSettings } from "./appDefaults";

describe("应用默认状态", () => {
  it("默认状态不包含演示业务数据", () => {
    const data = createEmptyAppData();

    expect(data.nodes).toHaveLength(0);
    expect(data.groups).toHaveLength(0);
    expect(data.subscriptions).toHaveLength(0);
    expect(data.rules).toHaveLength(0);
    expect(data.connections).toHaveLength(0);
    expect(data.logs).toHaveLength(0);
  });

  it("默认设置包含 Mihomo 控制器连接信息", () => {
    expect(defaultSettings.externalController).toBe("127.0.0.1:9090");
    expect(defaultSettings.controllerPort).toBe(9090);
  });
});
