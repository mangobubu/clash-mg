import { Alert, Box, Stack, Toolbar } from "@mui/material";
import { routes } from "../app/routes";
import { useAppStatus } from "../shared/api/queries";
import { useUiStore } from "../shared/store/uiStore";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const sidebarWidth = 248;

export function AppShell() {
  const activeRoute = useUiStore((state) => state.activeRoute);
  const activeDefinition = routes.find((route) => route.id === activeRoute) ?? routes[0];
  const Page = activeDefinition.component;
  const appStatus = useAppStatus();

  return (
    <Box display="flex" height="100vh" bgcolor="background.default" color="text.primary">
      <Sidebar width={sidebarWidth} />
      <Box component="main" flex={1} minWidth={0} height="100vh" overflow="auto">
        <Topbar title={activeDefinition.label} status={appStatus.data} />
        <Toolbar />
        <Stack spacing={2} p={3}>
          {appStatus.error ? (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Tauri 后端暂不可用，页面将保留布局但无法执行真实操作。
            </Alert>
          ) : null}
          <Page />
        </Stack>
      </Box>
    </Box>
  );
}
