import { useCallback } from "react";
import { useAppStore } from "./store/useAppStore";

export type AppLocale = "zh-CN" | "zh-TW" | "en";

const english: Record<string, string> = {
  "总览": "Dashboard", "代理": "Proxies", "节点": "Nodes", "订阅": "Subscriptions", "连接": "Connections", "日志": "Logs", "设置": "Settings",
  "常规": "General", "核心": "Core", "网络": "Network", "覆写": "Overrides", "界面": "Interface",
  "常规设置": "General Settings", "管理应用启动、系统代理、TUN 与端口行为。": "Manage startup, system proxy, TUN, and port behavior.",
  "管理核心、网络、DNS 与界面行为设置。": "Manage core, network, DNS, and interface behavior.",
  "重置默认": "Reset Defaults", "保存设置": "Save Settings", "刚刚": "Just now", "设置已保存并应用": "Settings saved and applied",
  "重置全部设置？": "Reset all settings?", "将恢复应用默认配置，页面中的修改会被覆盖。": "Restore application defaults and discard changes on this page.",
  "重置": "Reset", "取消": "Cancel", "已恢复默认设置": "Default settings restored",
  "应用行为": "Application Behavior", "开机启动": "Launch at startup", "系统启动时自动运行 Clash-MG": "Run Clash-MG when the system starts",
  "关闭窗口时最小化到托盘": "Minimize to tray on close", "点击关闭按钮时最小化到系统托盘": "Hide the window in the system tray when closing",
  "静默启动": "Silent launch", "启动时最小化到托盘，不显示主窗口": "Start in the system tray without showing the main window",
  "启动时自动连接": "Auto-connect on startup", "启动完成后自动连接到上次连接的节点": "Restore the last selected node after startup",
  "自动检查更新": "Automatically check for updates", "定期检查新版本并提示更新": "Periodically check for new releases",
  "语言": "Language", "选择应用界面语言": "Choose the application interface language",
  "系统代理与 TUN": "System Proxy and TUN", "系统代理": "System proxy", "启用后将系统流量通过代理转发": "Route system traffic through the proxy",
  "TUN 模式": "TUN mode", "启用后将所有流量通过 TUN 接口转发": "Route all traffic through the TUN interface",
  "允许局域网连接": "Allow LAN connections", "允许来自局域网设备的连接": "Allow connections from devices on the local network",
  "启用 IPv6 支持": "Enable IPv6 support", "代理模式": "Proxy mode", "选择系统代理的工作模式": "Choose how the proxy handles traffic",
  "规则模式": "Rule", "全局模式": "Global", "直连模式": "Direct",
  "防火墙集成": "Firewall integration", "自动配置防火墙以放行代理端口": "Configure the firewall to allow proxy ports",
  "端口设置": "Port Settings", "混合端口": "Mixed port", "HTTP + SOCKS 混合端口": "Combined HTTP and SOCKS port",
  "SOCKS 端口": "SOCKS port", "SOCKS 代理端口": "SOCKS proxy port", "HTTP 端口": "HTTP port", "HTTP 代理端口": "HTTP proxy port",
  "外部控制器": "External controller", "外部控制 API 端口": "External control API port", "Web UI 访问密钥（留空则不启用）": "Web UI access secret (leave empty to disable)",
  "连接并发限制": "Concurrent connection limit", "最大并发连接数（0 为不限制）": "Maximum concurrent connections (0 means unlimited)",
  "浅色": "Light", "深色": "Dark", "跟随系统": "System", "简体中文": "Simplified Chinese", "繁體中文": "Traditional Chinese",
  "状态": "Status", "当前核心": "Current core", "控制器": "Controller", "最后保存": "Last saved",
  "搜索节点 / 规则 / 日志": "Search nodes / rules / logs", "全局搜索": "Global Search",
  "搜索节点名称、规则内容或日志...": "Search node names, rules, or logs...", "输入关键词以搜索整个应用": "Enter a keyword to search the application",
  "没有找到匹配内容": "No matching content found",
};

const traditional: Record<string, string> = {
  "总览": "總覽", "代理": "代理", "节点": "節點", "订阅": "訂閱", "连接": "連線", "日志": "日誌", "设置": "設定",
  "常规": "常規", "核心": "核心", "网络": "網路", "覆写": "覆寫", "界面": "介面", "保存设置": "儲存設定", "重置默认": "重設預設值",
  "简体中文": "簡體中文", "繁體中文": "繁體中文", "语言": "語言", "浅色": "淺色", "深色": "深色", "跟随系统": "跟隨系統",
};

const simplifiedCharacters = [..."设置规应为启关闭时动连接统网务器节点选择护墙端口并发限数默认储览语体简复滚显将过转来从设内核与行"];
const traditionalCharacterValues = [..."設定規應為啟關閉時動連線統網務器節點選擇護牆連接埠並發限數預設儲覽語體簡復滾顯將過轉來從設核心與行"];
const traditionalCharacters: Record<string, string> = Object.fromEntries(
  simplifiedCharacters.map((character, index) => [character, traditionalCharacterValues[index] ?? character]),
);

export function normalizeLocale(value: unknown): AppLocale {
  if (value === "English") return "en";
  if (value === "繁體中文") return "zh-TW";
  return "zh-CN";
}

export function translate(locale: AppLocale, value: string): string {
  if (locale === "en") return english[value] ?? value;
  if (locale === "zh-TW") {
    return traditional[value] ?? [...value].map((character) => traditionalCharacters[character] ?? character).join("");
  }
  return value;
}

export function useI18n() {
  const language = useAppStore((state) => state.settings.language);
  const locale = normalizeLocale(language);
  const t = useCallback((value: string) => translate(locale, value), [locale]);
  return { locale, t };
}
