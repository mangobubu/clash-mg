import { routes } from "../../app/routes";
import { useUiStore } from "../store/uiStore";

export function usePageTitle() {
  const activeRoute = useUiStore((state) => state.activeRoute);
  return routes.find((route) => route.id === activeRoute)?.label ?? "总览";
}
