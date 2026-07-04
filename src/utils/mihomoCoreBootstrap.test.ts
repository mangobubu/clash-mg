import { describe, expect, it } from "vitest";
import { shouldBootstrapMihomoCore } from "./mihomoCoreBootstrap";

describe("shouldBootstrapMihomoCore", () => {
  it("手动启动且未开启系统代理时不随应用拉起内核", () => {
    expect(shouldBootstrapMihomoCore({
      coreStartTiming: "手动启动",
      systemProxy: false,
    })).toBe(false);
  });

  it("手动启动但已开启系统代理时仍随应用拉起内核", () => {
    expect(shouldBootstrapMihomoCore({
      coreStartTiming: "手动启动",
      systemProxy: true,
    })).toBe(true);
  });

  it("配置为应用打开时运行时随应用拉起内核", () => {
    expect(shouldBootstrapMihomoCore({
      coreStartTiming: "应用打开时运行",
      systemProxy: false,
    })).toBe(true);
  });
});
