import { useEffect, useMemo, useState } from "react";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BellOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HomeOutlined,
  LeftOutlined,
  LineChartOutlined,
  MoonOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { Button, Flex, Input, List, Menu, Modal, Popover, Segmented, Tag, Tooltip, Typography, message } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import type { ThemeMode } from "../types";
import { formatMemoryMegabytes, formatRuntimeByteRate } from "../utils/runtimeMetrics";
import { isTauriRuntime } from "../utils/tauri";
import { AppLogo, StatusDot } from "./Common";
import { useRuntimeMetrics } from "./useRuntimeMetrics";

const { Text } = Typography;

const navigation = [
  { key: "/", icon: <HomeOutlined />, label: "总览" },
  { key: "/proxies", icon: <LineChartOutlined />, label: "代理" },
  { key: "/nodes", icon: <ApartmentOutlined />, label: "节点" },
  { key: "/subscriptions", icon: <CloudDownloadOutlined />, label: "订阅" },
  { key: "/rules", icon: <FileTextOutlined />, label: "规则" },
  { key: "/connections", icon: <DashboardOutlined />, label: "连接" },
  { key: "/logs", icon: <AppstoreOutlined />, label: "日志" },
  { key: "/settings/general", icon: <SettingOutlined />, label: "设置" },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationsRead, setNotificationsRead] = useState(false);
  const {
    themeMode,
    setThemeMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    nodes,
    rules,
    logs,
    activities,
    settings,
    runtime,
  } = useAppStore();
  const runtimeMetrics = useRuntimeMetrics({
    controllerUrl: runtime.controllerUrl,
    secret: String(settings.uiSecret ?? ""),
    enabled: runtime.controllerConnected,
  });
  const uploadSpeed = formatRuntimeByteRate(runtimeMetrics.uploadBytesPerSecond);
  const downloadSpeed = formatRuntimeByteRate(runtimeMetrics.downloadBytesPerSecond);
  const memoryUsage = formatMemoryMegabytes(runtimeMetrics.memoryBytes);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedKey = location.pathname.startsWith("/settings")
    ? "/settings/general"
    : navigation.find((item) => item.key !== "/" && location.pathname.startsWith(item.key))?.key ?? "/";

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    const nodeResults = nodes
      .filter((node) => `${node.name}${node.address}${node.protocol}`.toLowerCase().includes(keyword))
      .map((node) => ({ id: `node-${node.id}`, title: node.name, subtitle: `${node.protocol} · ${node.address}`, type: "节点", path: "/nodes" }));
    const ruleResults = rules
      .filter((rule) => `${rule.type}${rule.content}${rule.policy}`.toLowerCase().includes(keyword))
      .map((rule) => ({ id: `rule-${rule.id}`, title: rule.content, subtitle: `${rule.type} · ${rule.policy}`, type: "规则", path: "/rules" }));
    const logResults = logs
      .filter((log) => `${log.source}${log.content}${log.level}`.toLowerCase().includes(keyword))
      .map((log) => ({ id: `log-${log.id}`, title: log.content, subtitle: `${log.time} · ${log.source}`, type: "日志", path: "/logs" }));
    return [...nodeResults, ...ruleResults, ...logResults].slice(0, 12);
  }, [logs, nodes, query, rules]);

  const notifications = useMemo(
    () => [
      ...activities.slice(0, 4).map((activity) => ({
        id: `activity-${activity.id}`,
        title: "活动事件",
        content: activity.content,
        time: activity.time,
        tone: activity.kind === "success" ? "success" as const : "processing" as const,
      })),
      ...logs.slice(0, 4).map((log) => ({
        id: `log-${log.id}`,
        title: `${log.source} · ${log.level}`,
        content: log.content,
        time: log.time,
        tone: log.level === "SUCCESS" ? "success" as const : log.level === "ERROR" || log.level === "WARNING" ? "processing" as const : "default" as const,
      })),
    ].slice(0, 6),
    [activities, logs],
  );
  const unreadNotificationCount = notificationsRead ? 0 : notifications.length;

  const openConnectionsWindow = async () => {
    try {
      await invoke("open_connections_window");
    } catch (error) {
      console.error(error);
      message.error("连接窗口打开失败，请确认已重启 Tauri 桌面应用");
    }
  };

  const handleNavigation = async (key: string) => {
    if (key === "/connections") {
      const isDesktopRuntime = await isTauriRuntime();
      if (isDesktopRuntime) {
        await openConnectionsWindow();
        return;
      }
    }

    navigate(key);
  };

  const markNotificationsRead = () => {
    if (unreadNotificationCount === 0) {
      message.info("暂无未读通知");
      return;
    }
    setNotificationsRead(true);
    message.success("通知已全部标记为已读");
  };

  const notificationContent = (
    <div className="notification-popover">
      <div className="popover-title">
        <strong>通知中心</strong>
        <Flex align="center" gap={6}>
          <Tag color={unreadNotificationCount > 0 ? "cyan" : "default"}>{unreadNotificationCount} 未读</Tag>
          <Button type="link" size="small" onClick={markNotificationsRead}>全部已读</Button>
        </Flex>
      </div>
      <List
        dataSource={notifications}
        renderItem={(item) => (
          <List.Item key={item.id}>
            <List.Item.Meta
              avatar={<StatusDot status={unreadNotificationCount > 0 ? item.tone : "default"}><span /></StatusDot>}
              title={item.title}
              description={<><div>{item.content}</div><Text type="secondary">{item.time}</Text></>}
            />
          </List.Item>
        )}
      />
    </div>
  );

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppLogo compact={sidebarCollapsed} />
          <Tooltip title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
            <Button
              type="text"
              className="sidebar-collapse"
              icon={sidebarCollapsed ? <RightOutlined /> : <LeftOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            />
          </Tooltip>
        </div>
        <Menu
          mode="inline"
          inlineCollapsed={sidebarCollapsed}
          selectedKeys={[selectedKey]}
          items={navigation}
          onClick={({ key }) => void handleNavigation(String(key))}
        />
        <div className="sidebar-spacer" />
        <div className="runtime-metrics" role="group" aria-label="实时运行指标">
          <Tooltip title={`总上传速度 ${uploadSpeed}`} placement="right">
            <div className="runtime-metric runtime-metric-upload" aria-label={`总上传速度 ${uploadSpeed}`}>
              <span className="runtime-metric-icon"><ArrowUpOutlined /></span>
              <strong>{uploadSpeed}</strong>
            </div>
          </Tooltip>
          <Tooltip title={`总下载速度 ${downloadSpeed}`} placement="right">
            <div className="runtime-metric runtime-metric-download" aria-label={`总下载速度 ${downloadSpeed}`}>
              <span className="runtime-metric-icon"><ArrowDownOutlined /></span>
              <strong>{downloadSpeed}</strong>
            </div>
          </Tooltip>
          <Tooltip title={`内存占用 ${memoryUsage}`} placement="right">
            <div className="runtime-metric runtime-metric-memory" aria-label={`内存占用 ${memoryUsage}`}>
              <span className="runtime-metric-icon"><DatabaseOutlined /></span>
              <strong>{memoryUsage}</strong>
            </div>
          </Tooltip>
        </div>
      </aside>

      <header className="topbar">
        <button className="global-search-trigger" onClick={() => setSearchOpen(true)}>
          <SearchOutlined />
          <span>搜索节点 / 规则 / 日志</span>
          <kbd>⌘K</kbd>
        </button>
        <Segmented
          className="theme-toggle"
          size="large"
          value={themeMode}
          onChange={(value) => setThemeMode(value as ThemeMode)}
          options={[
            { value: "light", icon: <SunOutlined />, label: "" },
            { value: "dark", icon: <MoonOutlined />, label: "" },
          ]}
        />
        <Popover content={notificationContent} trigger="click" placement="bottomRight">
          <Button size="large" icon={<BellOutlined />} className="notification-button">{unreadNotificationCount > 0 && <i />}</Button>
        </Popover>
      </header>

      <main className="app-main"><Outlet /></main>

      <Modal
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        width={680}
        className="search-modal"
        title="全局搜索"
        destroyOnHidden
      >
        <Input
          autoFocus
          size="large"
          prefix={<SearchOutlined />}
          placeholder="搜索节点名称、规则内容或日志..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        {!query ? (
          <div className="search-help">
            <Text type="secondary">输入关键词以搜索整个应用</Text>
            <Flex gap={8}><Tag>香港</Tag><Tag>openai.com</Tag><Tag>DNS</Tag></Flex>
          </div>
        ) : (
          <List
            className="search-results"
            locale={{ emptyText: "没有找到匹配内容" }}
            dataSource={results}
            renderItem={(item) => (
              <List.Item
                className="search-result-item"
                onClick={() => { navigate(item.path); setSearchOpen(false); setQuery(""); }}
                extra={<Tag>{item.type}</Tag>}
              >
                <List.Item.Meta title={item.title} description={item.subtitle} />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  );
}
