import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type RouteId =
  | "dashboard"
  | "proxies"
  | "profiles"
  | "rules"
  | "connections"
  | "logs"
  | "settings";

export type RouteDefinition = {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
};
