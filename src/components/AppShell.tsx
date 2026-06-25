import { useEffect, useMemo, useState } from "react";
import {
  AppstoreOutlined,
  BellOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CompressOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HomeOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SearchOutlined,
  SettingOutlined,
  ShrinkOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { Button, Divider, Flex, Input, List, Menu, Modal, Popover, Segmented, Tag, Tooltip, Typography, message } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import type { ThemeMode } from "../types";
import { AppLogo, StatusDot } from "./Common";

const { Text } = Typography;

const navigation = [
  { key: "/", icon: <HomeOutlined />, label: "总览" },
  { key: "/proxies", icon: <LineChartOutlined />, label: "代理" },
  { key: "/subscriptions", icon: <CloudDownloadOutlined />, label: "订阅" },
  { key: "/rules", icon: <FileTextOutlined />, label: "规则" },
  { key: "/connections", icon: <DashboardOutlined />, label: "连接" },
  { key: "/logs", icon: <AppstoreOutlined />, label: "日志" },
  { key: "/settings/general", icon: <SettingOutlined />, label: "设置" },
];

const notifications: Array<{ title: string; content: string; time: string; tone: "success" | "processing" | "default" }> = [
  { title: "订阅更新成功", content: "机场主订阅已导入 128 个节点", time: "5 分钟前", tone: "success" },
  { title: "节点延迟变化", content: "香港 IEPL 01 当前延迟 38 ms", time: "12 分钟前", tone: "processing" },
  { title: "新版本可用", content: "Clash Meta v1.18.5 已是最新版本", time: "今天", tone: "default" },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(notifications.length);
  const {
    themeMode,
    setThemeMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    nodes,
    rules,
    logs,
  } = useAppStore();

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
      .map((node) => ({ id: `node-${node.id}`, title: node.name, subtitle: `${node.protocol} · ${node.address}`, type: "节点", path: "/proxies" }));
    const ruleResults = rules
      .filter((rule) => `${rule.type}${rule.content}${rule.policy}`.toLowerCase().includes(keyword))
      .map((rule) => ({ id: `rule-${rule.id}`, title: rule.content, subtitle: `${rule.type} · ${rule.policy}`, type: "规则", path: "/rules" }));
    const logResults = logs
      .filter((log) => `${log.source}${log.content}${log.level}`.toLowerCase().includes(keyword))
      .map((log) => ({ id: `log-${log.id}`, title: log.content, subtitle: `${log.time} · ${log.source}`, type: "日志", path: "/logs" }));
    return [...nodeResults, ...ruleResults, ...logResults].slice(0, 12);
  }, [logs, nodes, query, rules]);

  const runWindowAction = async (action: "minimize" | "toggleMaximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) {
      message.info("窗口控制将在 Tauri 桌面环境中生效");
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "toggleMaximize") await appWindow.toggleMaximize();
    if (action === "close") await appWindow.close();
  };

  const markNotificationsRead = () => {
    if (unreadNotificationCount === 0) {
      message.info("暂无未读通知");
      return;
    }
    setUnreadNotificationCount(0);
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
          <List.Item>
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
        <div className="sidebar-brand" data-tauri-drag-region>
          <AppLogo compact={sidebarCollapsed} />
          <Tooltip title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
            <Button
              type="text"
              className="sidebar-collapse"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </Tooltip>
        </div>
        <Menu
          mode="inline"
          inlineCollapsed={sidebarCollapsed}
          selectedKeys={[selectedKey]}
          items={navigation}
          onClick={({ key }) => navigate(key)}
        />
        <div className="sidebar-spacer" />
        <div className="core-status">
          {sidebarCollapsed ? (
            <Tooltip title="Clash Meta · 运行正常"><span className="core-dot" /></Tooltip>
          ) : (
            <>
              <dl><dt>核心</dt><dd><StatusDot>Clash Meta</StatusDot></dd></dl>
              <dl><dt>版本</dt><dd>v1.18.5</dd></dl>
              <dl><dt>本地端口</dt><dd>7890</dd></dl>
              <dl><dt>Uptime</dt><dd>2h 35m 18s</dd></dl>
              <Divider />
              <div className="latest-version"><StatusDot>已是最新版本</StatusDot></div>
            </>
          )}
        </div>
      </aside>

      <header className="topbar" data-tauri-drag-region>
        <button className="global-search-trigger" onClick={() => setSearchOpen(true)} data-tauri-drag-region="false">
          <SearchOutlined />
          <span>搜索节点 / 规则 / 日志</span>
          <kbd>⌘K</kbd>
        </button>
        <Segmented
          size="large"
          value={themeMode}
          onChange={(value) => setThemeMode(value as ThemeMode)}
          options={[
            { value: "light", icon: <SunOutlined />, label: "" },
            { value: "dark", icon: <MoonOutlined />, label: "" },
            { value: "system", icon: <CompressOutlined />, label: "" },
          ]}
        />
        <Popover content={notificationContent} trigger="click" placement="bottomRight">
          <Button size="large" icon={<BellOutlined />} className="notification-button">{unreadNotificationCount > 0 && <i />}</Button>
        </Popover>
        <Flex className="window-controls" gap={2} data-tauri-drag-region="false">
          <Button type="text" icon={<ShrinkOutlined />} onClick={() => void runWindowAction("minimize")} aria-label="最小化" />
          <Button type="text" icon={<span className="maximize-icon" />} onClick={() => void runWindowAction("toggleMaximize")} aria-label="最大化" />
          <Button type="text" danger icon={<CloseOutlined />} onClick={() => void runWindowAction("close")} aria-label="关闭" />
        </Flex>
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
