import { describe, expect, it } from "vitest";
import { normalizeLocale, translate } from "./i18n";

describe("应用国际化", () => {
  it("识别三种界面语言", () => {
    expect(normalizeLocale("简体中文")).toBe("zh-CN");
    expect(normalizeLocale("繁體中文")).toBe("zh-TW");
    expect(normalizeLocale("English")).toBe("en");
  });

  it("翻译常规设置核心文案", () => {
    expect(translate("en", "开机启动")).toBe("Launch at startup");
    expect(translate("zh-TW", "保存设置")).toBe("儲存設定");
    expect(translate("zh-CN", "系统代理")).toBe("系统代理");
  });
});
