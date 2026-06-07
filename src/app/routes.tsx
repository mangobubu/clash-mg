import { Activity, FileCode2, Gauge, Network, Radio, Route, Settings, TerminalSquare } from "lucide-react";
import { ConnectionsPage } from "../features/connections/ConnectionsPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LogsPage } from "../features/logs/LogsPage";
import { ProfilesPage } from "../features/profiles/ProfilesPage";
import { ProxiesPage } from "../features/proxies/ProxiesPage";
import { RulesPage } from "../features/rules/RulesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import type { RouteDefinition } from "../shared/types/navigation";

export const routes: RouteDefinition[] = [
  {
    id: "dashboard",
    label: "总览",
    icon: Gauge,
    component: DashboardPage,
  },
  {
    id: "proxies",
    label: "代理",
    icon: Network,
    component: ProxiesPage,
  },
  {
    id: "profiles",
    label: "配置",
    icon: FileCode2,
    component: ProfilesPage,
  },
  {
    id: "rules",
    label: "规则",
    icon: Route,
    component: RulesPage,
  },
  {
    id: "connections",
    label: "连接",
    icon: Radio,
    component: ConnectionsPage,
  },
  {
    id: "logs",
    label: "日志",
    icon: TerminalSquare,
    component: LogsPage,
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    component: SettingsPage,
  },
];

export const statusRouteIcon = Activity;
