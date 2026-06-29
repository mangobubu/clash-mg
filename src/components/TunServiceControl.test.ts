import { describe, expect, it } from "vitest";
import { isTunServiceAvailable, isTunSwitchLoading } from "./TunServiceControl";

describe("isTunServiceAvailable", () => {
  it("只有服务已安装、版本匹配且可连接时才允许使用 TUN", () => {
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true })).toBe(true);
    expect(isTunServiceAvailable({ installed: false, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true, message: "服务离线" })).toBe(false);
  });
});

describe("isTunSwitchLoading", () => {
  it("服务状态检查或 TUN 切换未完成时保持加载状态", () => {
    expect(isTunSwitchLoading(true, false)).toBe(true);
    expect(isTunSwitchLoading(false, true)).toBe(true);
    expect(isTunSwitchLoading(false, false)).toBe(false);
  });
});
