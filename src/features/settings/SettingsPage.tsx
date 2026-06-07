import { Box } from "@mui/material";
import {
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { Settings } from "lucide-react";
import { useSettings, useUpdateSettings } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";
import { useUiStore } from "../../shared/store/uiStore";

export function SettingsPage() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const data = settings.data;

  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap={2}>
      <Box>
        <Card>
          <CardContent>
            <SectionHeader title="系统设置" icon={Settings} />
            <Stack spacing={1.25} mt={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={data?.system_proxy ?? false}
                    onChange={(event) => updateSettings.mutate({ system_proxy: event.target.checked })}
                  />
                }
                label="系统代理"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={data?.tun_mode ?? false}
                    onChange={(event) => updateSettings.mutate({ tun_mode: event.target.checked })}
                  />
                }
                label="TUN 模式"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={data?.auto_start ?? false}
                    onChange={(event) => updateSettings.mutate({ auto_start: event.target.checked })}
                  />
                }
                label="开机自启动"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={data?.silent_start ?? false}
                    onChange={(event) => updateSettings.mutate({ silent_start: event.target.checked })}
                  />
                }
                label="静默启动"
              />
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <Box>
        <Card>
          <CardContent>
            <SectionHeader title="常规设置" icon={Settings} />
            <Stack spacing={2} mt={2}>
              <FormControl size="small">
                <InputLabel>主题</InputLabel>
                <Select
                  label="主题"
                  value={data?.theme ?? "light"}
                  onChange={(event) => {
                    const theme = event.target.value as "light" | "dark";
                    setThemeMode(theme);
                    updateSettings.mutate({ theme });
                  }}
                >
                  <MenuItem value="light">亮色</MenuItem>
                  <MenuItem value="dark">暗色</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel>日志级别</InputLabel>
                <Select
                  label="日志级别"
                  value={data?.log_level ?? "info"}
                  onChange={(event) =>
                    updateSettings.mutate({ log_level: event.target.value as "info" })
                  }
                >
                  <MenuItem value="debug">Debug</MenuItem>
                  <MenuItem value="info">Info</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                  <MenuItem value="error">Error</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Mixed Port"
                size="small"
                type="number"
                value={data?.mixed_port ?? 7890}
                onChange={(event) => updateSettings.mutate({ mixed_port: Number(event.target.value) })}
              />
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
