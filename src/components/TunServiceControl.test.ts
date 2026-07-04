import { describe, expect, it } from "vitest";
import {
  getEffectiveTunSettings,
  isTunServiceAvailable,
  isTunServiceRepairRequired,
  isTunSwitchLoading,
} from "./TunServiceControl";

describe("isTunServiceAvailable", () => {
  it("只有服务已安装、版本匹配且可连接时才允许使用 TUN", () => {
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true })).toBe(true);
    expect(isTunServiceAvailable({ installed: false, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: false })).toBe(false);
    expect(isTunServiceAvailable({ installed: true, running: false, versionCompatible: true, message: "服务离线" })).toBe(false);
  });
});

describe("isTunServiceRepairRequired", () => {
  it("已安装但版本不匹配、服务不可用或内核未运行时进入修复流程，而不是删除流程", () => {
    expect(isTunServiceRepairRequired({ installed: true, running: false, versionCompatible: false })).toBe(true);
    expect(isTunServiceRepairRequired({ installed: true, running: false, versionCompatible: true, message: "服务离线" })).toBe(true);
    expect(isTunServiceRepairRequired({ installed: true, running: false, versionCompatible: true })).toBe(true);
    expect(isTunServiceRepairRequired({ installed: true, running: true, versionCompatible: true })).toBe(false);
    expect(isTunServiceRepairRequired({ installed: false, running: false, versionCompatible: false })).toBe(false);
  });
});

describe("isTunSwitchLoading", () => {
  it("服务状态检查或 TUN 切换未完成时保持加载状态", () => {
    expect(isTunSwitchLoading(true, false)).toBe(true);
    expect(isTunSwitchLoading(false, true)).toBe(true);
    expect(isTunSwitchLoading(false, false)).toBe(false);
  });
});

describe("getEffectiveTunSettings", () => {
  it("服务版本不匹配时仅关闭本次启动配置，不修改持久化设置", () => {
    const settings = { tunMode: true, mixedPort: 7890 };
    const effective = getEffectiveTunSettings(settings, {
      installed: true,
      running: true,
      versionCompatible: false,
      message: "系统服务版本与应用不一致",
    });

    expect(effective).toEqual({ tunMode: false, mixedPort: 7890 });
    expect(effective).not.toBe(settings);
    expect(settings.tunMode).toBe(true);
  });

  it("服务可用时保持原设置对象", () => {
    const settings = { tunMode: true };
    const effective = getEffectiveTunSettings(settings, {
      installed: true,
      running: true,
      versionCompatible: true,
    });

    expect(effective).toBe(settings);
  });
});
