import type { PaletteMode } from "@mui/material";
import { create } from "zustand";
import type { RouteId } from "../types/navigation";

type UiState = {
  activeRoute: RouteId;
  sidebarCollapsed: boolean;
  themeMode: PaletteMode;
  setActiveRoute: (route: RouteId) => void;
  toggleSidebar: () => void;
  setThemeMode: (mode: PaletteMode) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeRoute: "dashboard",
  sidebarCollapsed: false,
  themeMode: "light",
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setThemeMode: (themeMode) => set({ themeMode }),
}));
