import { describe, expect, it } from "vitest";
import { isTunServiceAvailable } from "./TunServiceControl";

describe("isTunServiceAvailable", () => {
  it("只有服务已安装、版本匹配且可连接时才允许使用 TUN", () => {
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true })).toBe(true);
    expect(isTunServiceAvailable({ installed: false, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true, message: "服务离线" })).toBe(false);
  });
});
