import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Stack,
  Typography,
} from "@mui/material";
import { Activity, Download, Gauge, Play, Radio, RefreshCw, Search, UploadCloud, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStatus, useConnections, useCoreActions, useProfiles } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";
import type { ConnectionSummary } from "../../shared/types/domain";

type ConnectionSortKey =
  | "host"
  | "process"
  | "network"
  | "rule"
  | "chain"
  | "upload"
  | "download"
  | "created_at";
type SortDirection = "asc" | "desc";

export function DashboardPage() {
  const status = useAppStatus();
  const profiles = useProfiles();
  const connections = useConnections();
  const coreActions = useCoreActions();
  const [connectionSearch, setConnectionSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("all");
  const [sortKey, setSortKey] = useState<ConnectionSortKey>("download");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const activeProfile = profiles.data?.find((profile) => profile.active);

  const processOptions = useMemo(() => {
    return Array.from(new Set((connections.data ?? []).map((connection) => connection.process))).sort(
      (left, right) => left.localeCompare(right, "zh-CN"),
    );
  }, [connections.data]);
  const processFilterOptions = useMemo(() => {
    return [
      { label: "全部进程", value: "all" },
      ...processOptions.map((process) => ({ label: process, value: process })),
    ];
  }, [processOptions]);
  const selectedProcessOption =
    processFilterOptions.find((option) => option.value === processFilter) ?? processFilterOptions[0];

  const visibleConnections = useMemo(() => {
    const keyword = connectionSearch.trim().toLowerCase();
    const filtered = (connections.data ?? []).filter((connection) => {
      if (connection.upload <= 0 && connection.download <= 0) {
        return false;
      }

      if (processFilter !== "all" && connection.process !== processFilter) {
        return false;
      }

      if (!keyword) return true;
      return [
        connection.host,
        connection.network,
        connection.rule,
        connection.chain.join(" "),
        connection.created_at,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });

    return [...filtered].sort((left, right) => {
      const result = compareConnections(left, right, sortKey);
      return sortDirection === "asc" ? result : -result;
    });
  }, [connectionSearch, connections.data, processFilter, sortDirection, sortKey]);

  const handleSort = (key: ConnectionSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "upload" || key === "download" ? "desc" : "asc");
  };

  const metrics = [
    { label: "上传", value: "1.8 MB/s", icon: UploadCloud },
    { label: "下载", value: "12.4 MB/s", icon: Download },
    { label: "连接", value: "186", icon: Activity },
    { label: "延迟", value: "42 ms", icon: Zap },
  ];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <SectionHeader
              title="运行总览"
              description={`当前配置：${activeProfile?.name ?? "未激活配置"}`}
              icon={Gauge}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<RefreshCw size={16} />}
                onClick={() => coreActions.restart.mutate()}
                disabled={coreActions.restart.isPending}
              >
                重启核心
              </Button>
              <Button
                variant="contained"
                startIcon={<Play size={16} />}
                onClick={() => coreActions.start.mutate()}
                disabled={status.data?.core.running || coreActions.start.isPending}
              >
                启动
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap={2}>
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Box key={metric.label}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                      width={42}
                      height={42}
                      borderRadius={2}
                      display="grid"
                      sx={{ placeItems: "center" }}
                      bgcolor="primary.main"
                      color="primary.contrastText"
                    >
                      <Icon size={19} />
                    </Box>
                    <Box>
                      <Typography color="text.secondary" fontSize={13}>
                        {metric.label}
                      </Typography>
                      <Typography fontSize={22} fontWeight={900}>
                        {metric.value}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Box>
          );
        })}
      </Box>

      <Box display="grid" gridTemplateColumns={{ xs: "1fr", lg: "minmax(0, 7fr) minmax(320px, 5fr)" }} gap={2}>
        <Box>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                <SectionHeader
                  title="当前连接"
                  description={`${visibleConnections.length} 条连接`}
                  icon={Radio}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Autocomplete
                    size="small"
                    options={processFilterOptions}
                    value={selectedProcessOption}
                    clearText="清空"
                    noOptionsText="无匹配进程"
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.value === value.value}
                    onChange={(_, option) => setProcessFilter(option?.value ?? "all")}
                    sx={{ width: 190 }}
                    renderInput={(params) => <TextField {...params} label="进程" placeholder="输入进程" />}
                  />
                  <TextField
                    size="small"
                    value={connectionSearch}
                    onChange={(event) => setConnectionSearch(event.target.value)}
                    placeholder="搜索目标、规则、链路"
                    sx={{ width: 270 }}
                    InputProps={{
                      startAdornment: (
                        <Box color="text.secondary" display="grid" mr={1} sx={{ placeItems: "center" }}>
                          <Search size={16} />
                        </Box>
                      ),
                    }}
                  />
                </Stack>
              </Stack>
              <Box mt={2} overflow="auto">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <SortableHeader
                        label="目标"
                        active={sortKey === "host"}
                        direction={sortDirection}
                        onClick={() => handleSort("host")}
                      />
                      <SortableHeader
                        label="进程"
                        active={sortKey === "process"}
                        direction={sortDirection}
                        onClick={() => handleSort("process")}
                      />
                      <SortableHeader
                        label="网络"
                        active={sortKey === "network"}
                        direction={sortDirection}
                        onClick={() => handleSort("network")}
                      />
                      <SortableHeader
                        label="规则"
                        active={sortKey === "rule"}
                        direction={sortDirection}
                        onClick={() => handleSort("rule")}
                      />
                      <SortableHeader
                        label="链路"
                        active={sortKey === "chain"}
                        direction={sortDirection}
                        onClick={() => handleSort("chain")}
                      />
                      <SortableHeader
                        label="上传速度"
                        active={sortKey === "upload"}
                        direction={sortDirection}
                        align="right"
                        onClick={() => handleSort("upload")}
                      />
                      <SortableHeader
                        label="下载速度"
                        active={sortKey === "download"}
                        direction={sortDirection}
                        align="right"
                        onClick={() => handleSort("download")}
                      />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleConnections.map((connection) => (
                      <TableRow key={connection.id} hover>
                        <TableCell>
                          <Typography fontWeight={800} noWrap>
                            {connection.host}
                          </Typography>
                          <Typography color="text.secondary" fontSize={12}>
                            {connection.created_at}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography fontWeight={800} noWrap>
                            {connection.process}
                          </Typography>
                          <Typography color="text.secondary" fontSize={12} noWrap maxWidth={180}>
                            {connection.process_path ?? "未知路径"}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={connection.network.toUpperCase()} />
                        </TableCell>
                        <TableCell>{connection.rule}</TableCell>
                        <TableCell>{connection.chain.join(" / ")}</TableCell>
                        <TableCell align="right">{formatSpeed(connection.upload)}</TableCell>
                        <TableCell align="right">{formatSpeed(connection.download)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Box>
        <Box>
          <Card>
            <CardContent>
              <SectionHeader title="核心信息" icon={Gauge} />
              <Stack spacing={1.25} mt={2}>
                <InfoRow label="状态" value={status.data?.core.running ? "运行中" : "未启动"} />
                <InfoRow label="版本" value={status.data?.core.version ?? "mihomo-compatible"} />
                <InfoRow label="Mixed Port" value={String(status.data?.core.mixed_port ?? 7890)} />
                <InfoRow label="Controller" value={status.data?.core.controller_url ?? "127.0.0.1:9090"} />
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Stack>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography fontWeight={800} noWrap>
        {value}
      </Typography>
    </Stack>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  align?: "left" | "right";
  onClick: () => void;
}) {
  return (
    <TableCell align={align}>
      <TableSortLabel active={active} direction={active ? direction : "asc"} onClick={onClick}>
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

function compareConnections(
  left: ConnectionSummary,
  right: ConnectionSummary,
  sortKey: ConnectionSortKey,
) {
  if (sortKey === "upload" || sortKey === "download") {
    return left[sortKey] - right[sortKey];
  }

  const leftValue = sortKey === "chain" ? left.chain.join(" / ") : left[sortKey];
  const rightValue = sortKey === "chain" ? right.chain.join(" / ") : right[sortKey];
  return String(leftValue).localeCompare(String(rightValue), "zh-CN");
}

function formatSpeed(value: number) {
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}
