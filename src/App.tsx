import { lazy, Suspense, useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAppStore } from "./store/useAppStore";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const ProxiesPage = lazy(() => import("./pages/ProxiesPage").then((module) => ({ default: module.ProxiesPage })));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage").then((module) => ({ default: module.SubscriptionsPage })));
const RulesPage = lazy(() => import("./pages/RulesPage").then((module) => ({ default: module.RulesPage })));
const ConnectionsPage = lazy(() => import("./pages/ConnectionsPage").then((module) => ({ default: module.ConnectionsPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));

export default function App() {
  const { themeMode, accent, settings } = useAppStore();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const isDark = themeMode === "dark" || (themeMode === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--ui-scale", String(Number.parseInt(String(settings.uiScale ?? "100%"), 10) / 100));
  }, [accent, isDark, settings.uiScale]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: accent,
          colorInfo: "#1677ff",
          colorSuccess: "#12b76a",
          colorWarning: "#f79009",
          colorError: "#f04438",
          borderRadius: settings.roundedStyle === "圆润" ? 14 : settings.roundedStyle === "紧凑" ? 6 : 9,
          fontFamily: 'Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif',
          controlHeight: 38,
        },
        components: {
          Button: { primaryShadow: "0 5px 14px color-mix(in srgb, var(--accent) 25%, transparent)" },
          Menu: { itemBorderRadius: 10, itemHeight: 56 },
          Table: { headerBg: "transparent", rowHoverBg: "color-mix(in srgb, var(--accent) 5%, transparent)" },
          Modal: { borderRadiusLG: 14 },
        },
      }}
    >
      <AntApp>
        <HashRouter>
          <Suspense fallback={<div className="route-loading"><Spin size="large" /></div>}>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="proxies" element={<ProxiesPage />} />
                <Route path="subscriptions" element={<SubscriptionsPage />} />
                <Route path="rules" element={<RulesPage />} />
                <Route path="connections" element={<ConnectionsPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="settings/:section" element={<SettingsPage />} />
                <Route path="settings" element={<Navigate to="/settings/general" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  );
}
