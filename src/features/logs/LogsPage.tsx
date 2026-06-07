import {
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { useLogs } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";
import type { CoreLogLevel, CoreLogSource } from "../../shared/types/domain";

type LogLevelFilter = CoreLogLevel | "all";
type LogSourceFilter = CoreLogSource | "all";

const logLevelOptions: Array<{ label: string; value: LogLevelFilter }> = [
  { label: "全部类型", value: "all" },
  { label: "info", value: "info" },
  { label: "debug", value: "debug" },
  { label: "warning", value: "warning" },
  { label: "error", value: "error" },
];

const logSourceOptions: Array<{ label: string; value: LogSourceFilter }> = [
  { label: "全部来源", value: "all" },
  { label: "核心", value: "core" },
  { label: "订阅", value: "profile" },
  { label: "代理", value: "proxy" },
  { label: "系统", value: "system" },
];

const logSourceLabels: Record<CoreLogSource, string> = {
  core: "核心",
  profile: "订阅",
  proxy: "代理",
  system: "系统",
};

export function LogsPage() {
  const logs = useLogs();
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<LogSourceFilter>("all");

  const visibleLogs = useMemo(() => {
    return (logs.data ?? []).filter((log) => {
      if (levelFilter !== "all" && log.level !== levelFilter) {
        return false;
      }

      if (sourceFilter !== "all" && log.source !== sourceFilter) {
        return false;
      }

      return true;
    });
  }, [levelFilter, logs.data, sourceFilter]);

  return (
    <Card>
      <CardContent>
        <SectionHeader title="实时日志" icon={TerminalSquare} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} mt={2} alignItems={{ sm: "center" }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>日志类型</InputLabel>
            <Select
              label="日志类型"
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as LogLevelFilter)}
            >
              {logLevelOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>日志来源</InputLabel>
            <Select
              label="日志来源"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as LogSourceFilter)}
            >
              {logSourceOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography color="text.secondary" fontSize={13}>
            共 {visibleLogs.length} 条
          </Typography>
        </Stack>
        <Stack
          mt={1.5}
          spacing={1}
          bgcolor="#101820"
          borderRadius={2}
          p={1.5}
          minHeight={440}
          overflow="auto"
        >
          {visibleLogs.length === 0 ? (
            <Typography color="#8ca4b0" fontSize={13} py={3} textAlign="center">
              当前筛选条件下暂无日志
            </Typography>
          ) : null}
          {visibleLogs.map((log) => (
            <Box
              key={`${log.timestamp}-${log.source}-${log.level}-${log.message}`}
              component="code"
              display="grid"
              gridTemplateColumns={{ xs: "82px 58px 72px minmax(0, 1fr)", sm: "92px 70px 86px minmax(0, 1fr)" }}
              gap={1.5}
              alignItems="center"
              color="#c6e4dc"
              fontSize={12}
            >
              <Typography component="span" color="#8ca4b0" fontSize={12}>
                {log.timestamp}
              </Typography>
              <Chip
                size="small"
                label={logSourceLabels[log.source]}
                variant="outlined"
                sx={{ height: 22, color: "#9ad0c0", borderColor: "rgba(154, 208, 192, 0.35)", fontWeight: 800 }}
              />
              <Chip
                size="small"
                label={log.level}
                color={log.level === "error" ? "error" : log.level === "warning" ? "warning" : "success"}
                sx={{ height: 22, fontWeight: 800 }}
              />
              <Typography component="span" fontSize={12} noWrap>
                {log.message}
              </Typography>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
