import {
  AppBar,
  Box,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { Bell, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { queryClient } from "../app/queryClient";
import type { AppStatus } from "../shared/types/domain";
import { StatusPill } from "../shared/components/StatusPill";
import { useUiStore } from "../shared/store/uiStore";

type TopbarProps = {
  title: string;
  status?: AppStatus;
};

export function Topbar({ title, status }: TopbarProps) {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);

  return (
    <AppBar
      position="fixed"
      elevation={0}
      color="transparent"
      sx={{
        left: 248,
        width: "calc(100% - 248px)",
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.default",
        backdropFilter: "blur(12px)",
      }}
    >
      <Toolbar sx={{ gap: 2 }}>
        <Box minWidth={130}>
          <Typography variant="h2">{title}</Typography>
          <Typography color="text.secondary" fontSize={12}>
            {status?.platform ?? "desktop"} · {status?.core.mode ?? "Rule"}
          </Typography>
        </Box>
        <TextField
          size="small"
          placeholder="搜索代理、规则、配置"
          sx={{ width: "min(460px, 42vw)" }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            ),
          }}
        />
        <Box flex={1} />
        <StatusPill
          label={status?.core.running ? "Core 在线" : "Core 离线"}
          tone={status?.core.running ? "success" : "warning"}
        />
        <Stack direction="row" spacing={1}>
          <Tooltip title="刷新">
            <IconButton onClick={() => queryClient.invalidateQueries()}>
              <RefreshCw size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="通知">
            <IconButton>
              <Bell size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={themeMode === "dark" ? "亮色模式" : "暗色模式"}>
            <IconButton onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}>
              {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
