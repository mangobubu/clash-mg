import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { App as AntApp, ConfigProvider, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAppStore } from "./store/useAppStore";
import { isTauriRuntime } from "./utils/tauri";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const ProxiesPage = lazy(() => import("./pages/ProxiesPage").then((module) => ({ default: module.ProxiesPage })));
const NodesPage = lazy(() => import("./pages/NodesPage").then((module) => ({ default: module.NodesPage })));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage").then((module) => ({ default: module.SubscriptionsPage })));
const RulesPage = lazy(() => import("./pages/RulesPage").then((module) => ({ default: module.RulesPage })));
const ConnectionsPage = lazy(() => import("./pages/ConnectionsPage").then((module) => ({ default: module.ConnectionsPage })));
const ConnectionDetailWindowPage = lazy(() => import("./pages/ConnectionDetailWindowPage").then((module) => ({ default: module.ConnectionDetailWindowPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const editableTargetSelector = "input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']";
const nonTextInputTypes = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  const editableElement = target.closest(editableTargetSelector);
  if (!editableElement) return false;

  if (editableElement instanceof HTMLInputElement) return !nonTextInputTypes.has(editableElement.type);

  return true;
}

function ConnectionsRoute() {
  const navigate = useNavigate();
  const [shouldRenderInMainWindow, setShouldRenderInMainWindow] = useState(false);

  useEffect(() => {
    let mounted = true;

    const openDesktopWindowOrRenderWebPage = async () => {
      const isDesktopRuntime = await isTauriRuntime();
      if (!isDesktopRuntime) {
        if (mounted) setShouldRenderInMainWindow(true);
        return;
      }

      try {
        await invoke("open_connections_window");
        navigate("/", { replace: true });
      } catch (error) {
        console.error(error);
        if (mounted) setShouldRenderInMainWindow(true);
      }
    };

    void openDesktopWindowOrRenderWebPage();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  if (!shouldRenderInMainWindow) return <div className="route-loading"><Spin size="large" /></div>;

  return <ConnectionsPage />;
}

export default function App() {
  const { themeMode, accent, settings, hydrated, initializeAppState } = useAppStore();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void initializeAppState();
  }, [initializeAppState]);

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

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    const preventNonEditableSelection = (event: Event) => {
      if (!isEditableTarget(event.target)) event.preventDefault();
    };

    document.addEventListener("contextmenu", preventNativeContextMenu);
    document.addEventListener("selectstart", preventNonEditableSelection);

    return () => {
      document.removeEventListener("contextmenu", preventNativeContextMenu);
      document.removeEventListener("selectstart", preventNonEditableSelection);
    };
  }, []);

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
            {!hydrated ? <div className="route-loading"><Spin size="large" /></div> : <Routes>
              <Route path="connections-window" element={<div className="standalone-window-page"><ConnectionsPage /></div>} />
              <Route path="connection-detail/:id" element={<ConnectionDetailWindowPage />} />
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="proxies" element={<ProxiesPage />} />
                <Route path="nodes" element={<NodesPage />} />
                <Route path="subscriptions" element={<SubscriptionsPage />} />
                <Route path="rules" element={<RulesPage />} />
                <Route path="connections" element={<ConnectionsRoute />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="settings/:section" element={<SettingsPage />} />
                <Route path="settings" element={<Navigate to="/settings/general" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>}
          </Suspense>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  );
}
