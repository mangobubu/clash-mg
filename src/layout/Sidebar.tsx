import {
  Box,
  Button,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { CirclePause, Play, Shield } from "lucide-react";
import { routes } from "../app/routes";
import { useAppStatus, useCoreActions } from "../shared/api/queries";
import { useUiStore } from "../shared/store/uiStore";

type SidebarProps = {
  width: number;
};

export function Sidebar({ width }: SidebarProps) {
  const activeRoute = useUiStore((state) => state.activeRoute);
  const setActiveRoute = useUiStore((state) => state.setActiveRoute);
  const status = useAppStatus();
  const coreActions = useCoreActions();
  const running = status.data?.core.running ?? false;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width,
          boxSizing: "border-box",
          borderRightColor: "divider",
          bgcolor: "background.paper",
        },
      }}
    >
      <Stack height="100%" p={1.75} spacing={2.5}>
        <Stack direction="row" alignItems="center" spacing={1.5} px={1}>
          <Box
            width={40}
            height={40}
            borderRadius={2}
            display="grid"
            sx={{ placeItems: "center" }}
            color="#fff"
            bgcolor="primary.main"
          >
            <Shield size={22} />
          </Box>
          <Box minWidth={0}>
            <Typography fontWeight={900} lineHeight={1.2}>
              Clash MG
            </Typography>
            <Typography color="text.secondary" fontSize={12} noWrap>
              Tauri Proxy Console
            </Typography>
          </Box>
        </Stack>

        <List dense disablePadding>
          {routes.map((route) => {
            const Icon = route.icon;
            const selected = route.id === activeRoute;
            return (
              <ListItemButton
                key={route.id}
                selected={selected}
                onClick={() => setActiveRoute(route.id)}
                sx={{
                  borderRadius: 2,
                  minHeight: 42,
                  mb: 0.5,
                  "&.Mui-selected": {
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                    "&:hover": { bgcolor: "primary.dark" },
                    "& .MuiListItemIcon-root": { color: "inherit" },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: selected ? "inherit" : "text.secondary" }}>
                  <Icon size={18} />
                </ListItemIcon>
                <ListItemText
                  primary={route.label}
                  primaryTypographyProps={{ fontWeight: selected ? 800 : 600 }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <Box flex={1} />
        <Stack spacing={1.25} p={1.5} border={1} borderColor="divider" borderRadius={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              width={10}
              height={10}
              borderRadius="50%"
              bgcolor={running ? "success.main" : "warning.main"}
              boxShadow={running ? "0 0 0 4px rgba(24, 166, 111, 0.16)" : "none"}
            />
            <Typography fontWeight={800}>{running ? "Core 运行中" : "Core 未启动"}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography color="text.secondary" fontSize={12}>
              {status.data?.core.version ?? "mihomo"}
            </Typography>
            <Typography color="text.secondary" fontSize={12}>
              :{status.data?.core.mixed_port ?? 7890}
            </Typography>
          </Stack>
          <Divider />
          <Button
            variant={running ? "outlined" : "contained"}
            startIcon={running ? <CirclePause size={16} /> : <Play size={16} />}
            onClick={() => {
              if (running) {
                coreActions.stop.mutate();
              } else {
                coreActions.start.mutate();
              }
            }}
            disabled={coreActions.start.isPending || coreActions.stop.isPending}
            fullWidth
          >
            {running ? "停止核心" : "启动核心"}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
