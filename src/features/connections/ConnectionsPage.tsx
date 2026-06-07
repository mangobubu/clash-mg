import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Download, ListFilter, Radio, Search, UploadCloud, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useCloseConnection, useConnections } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";
import type { ConnectionSummary } from "../../shared/types/domain";

type ProcessSummary = {
  name: string;
  count: number;
  uploadSpeed: number;
  downloadSpeed: number;
  uploadTotal: number;
  downloadTotal: number;
};

export function ConnectionsPage() {
  const connections = useConnections();
  const closeConnection = useCloseConnection();
  const [processFilter, setProcessFilter] = useState("all");
  const [processSearch, setProcessSearch] = useState("");
  const [processListSearch, setProcessListSearch] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [selectedConnection, setSelectedConnection] = useState<ConnectionSummary | null>(null);

  const processOptions = useMemo(() => {
    const processSummaries = new Map<string, ProcessSummary>();

    for (const connection of connections.data ?? []) {
      const current = processSummaries.get(connection.process) ?? {
        name: connection.process,
        count: 0,
        uploadSpeed: 0,
        downloadSpeed: 0,
        uploadTotal: 0,
        downloadTotal: 0,
      };

      current.count += 1;
      current.uploadSpeed += getUploadSpeed(connection);
      current.downloadSpeed += getDownloadSpeed(connection);
      current.uploadTotal += getUploadTotal(connection);
      current.downloadTotal += getDownloadTotal(connection);
      processSummaries.set(connection.process, current);
    }

    return Array.from(processSummaries.values()).sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    );
  }, [connections.data]);

  const totalConnections = connections.data?.length ?? 0;
  const totalProcessSummary = useMemo<ProcessSummary>(() => {
    return (connections.data ?? []).reduce(
      (summary, connection) => ({
        ...summary,
        count: summary.count + 1,
        uploadSpeed: summary.uploadSpeed + getUploadSpeed(connection),
        downloadSpeed: summary.downloadSpeed + getDownloadSpeed(connection),
        uploadTotal: summary.uploadTotal + getUploadTotal(connection),
        downloadTotal: summary.downloadTotal + getDownloadTotal(connection),
      }),
      {
        name: "全部进程",
        count: 0,
        uploadSpeed: 0,
        downloadSpeed: 0,
        uploadTotal: 0,
        downloadTotal: 0,
      },
    );
  }, [connections.data]);

  const processFilterOptions = useMemo(() => {
    return [
      { label: "全部进程", value: "all", count: totalConnections },
      ...processOptions.map((process) => ({
        label: process.name,
        value: process.name,
        count: process.count,
      })),
    ];
  }, [processOptions, totalConnections]);
  const selectedProcessOption =
    processFilterOptions.find((option) => option.value === processFilter) ?? processFilterOptions[0];

  const visibleProcessOptions = useMemo(() => {
    const keyword = processListSearch.trim().toLowerCase();
    if (!keyword) return processOptions;
    return processOptions.filter((process) => process.name.toLowerCase().includes(keyword));
  }, [processListSearch, processOptions]);

  const visibleConnections = useMemo(() => {
    const keyword = connectionSearch.trim().toLowerCase();

    return (connections.data ?? []).filter((connection) => {
      if (processFilter !== "all" && connection.process !== processFilter) {
        return false;
      }

      if (!keyword) return true;
      return [
        connection.host,
        connection.source_address,
        connection.destination_address,
        connection.destination_ip,
        connection.destination_domain,
        connection.destination_country,
        connection.destination_country_code,
        connection.connection_type,
        connection.process,
        connection.network,
        connection.rule,
        connection.chain.join(" "),
        connection.created_at,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [connectionSearch, connections.data, processFilter]);

  const handleProcessSelect = (value: string, options?: { syncSearch?: boolean }) => {
    setProcessFilter(value);

    if (options?.syncSearch) {
      setProcessSearch(value === "all" ? "全部进程" : value);
      setProcessListSearch("");
    }
  };

  const handleProcessSearchChange = (value: string) => {
    setProcessSearch(value);
    setProcessListSearch(value === "全部进程" ? "" : value);
  };

  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", lg: "280px minmax(0, 1fr)" }} gap={2}>
      <Card>
        <CardContent>
          <SectionHeader title="进程筛选" description={`${totalConnections} 条连接`} icon={ListFilter} />
          <Stack spacing={1} mt={2}>
            <Autocomplete
              size="small"
              options={processFilterOptions}
              value={selectedProcessOption}
              inputValue={processSearch}
              clearText="清空"
              noOptionsText="无匹配进程"
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              onInputChange={(_, value, reason) => {
                if (reason === "reset") return;
                handleProcessSearchChange(value);
              }}
              onChange={(_, option) => handleProcessSelect(option?.value ?? "all", { syncSearch: true })}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.value}>
                  <Stack direction="row" alignItems="center" width="100%" gap={1}>
                    <Typography flex={1} noWrap>
                      {option.label}
                    </Typography>
                    <Chip size="small" label={option.count} />
                  </Stack>
                </Box>
              )}
              renderInput={(params) => <TextField {...params} placeholder="输入进程" />}
            />
            <ProcessFilterButton
              summary={totalProcessSummary}
              active={processFilter === "all"}
              pinned
              onClick={() => handleProcessSelect("all")}
            />
            {visibleProcessOptions.map((process) => (
              <ProcessFilterButton
                key={process.name}
                summary={process}
                active={processFilter === process.name}
                onClick={() => handleProcessSelect(process.name)}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
            gap={2}
          >
            <SectionHeader title="活动连接" description={`${visibleConnections.length} 条连接`} icon={Radio} />
            <TextField
              size="small"
              value={connectionSearch}
              onChange={(event) => setConnectionSearch(event.target.value)}
              placeholder="搜索目标、源地址、IP、域名、国家"
              sx={{ width: { xs: "100%", sm: 320 } }}
              InputProps={{
                startAdornment: (
                  <Box color="text.secondary" display="grid" mr={1} sx={{ placeItems: "center" }}>
                    <Search size={16} />
                  </Box>
                ),
              }}
            />
          </Stack>
          <Box mt={2} overflow="auto">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>目标</TableCell>
                  <TableCell>源地址</TableCell>
                  <TableCell>进程</TableCell>
                  <TableCell>网络</TableCell>
                  <TableCell>类型</TableCell>
                  <TableCell>规则</TableCell>
                  <TableCell>链路</TableCell>
                  <TableCell align="right">实时</TableCell>
                  <TableCell align="right">总量</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleConnections.map((connection) => (
                  <TableRow
                    key={connection.id}
                    hover
                    onClick={() => setSelectedConnection(connection)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ minWidth: 240 }}>
                      <Stack direction="row" alignItems="center" spacing={1.25} minWidth={0}>
                        <CountryFlag
                          countryCode={connection.destination_country_code}
                          country={connection.destination_country}
                        />
                        <Box minWidth={0}>
                          <Typography fontWeight={800} noWrap>
                            {connection.destination_address ?? connection.host}
                          </Typography>
                          <Typography color="text.secondary" fontSize={12} noWrap>
                            {[connection.destination_domain ?? connection.host, connection.destination_ip]
                              .filter(Boolean)
                              .join(" · ")}
                          </Typography>
                          <Typography color="text.secondary" fontSize={12} noWrap>
                            {[connection.destination_country, connection.created_at].filter(Boolean).join(" · ")}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      <Typography fontWeight={700} noWrap>
                        {connection.source_address ?? "未知源地址"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={800}>{connection.process}</Typography>
                      <Typography color="text.secondary" fontSize={12} noWrap maxWidth={240}>
                        {connection.process_path ?? "未知路径"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={connection.network.toUpperCase()} />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={getConnectionType(connection)} />
                    </TableCell>
                    <TableCell>{connection.rule}</TableCell>
                    <TableCell>{connection.chain.join(" / ")}</TableCell>
                    <TableCell align="right">
                      <TrafficPair
                        upload={formatSpeed(getUploadSpeed(connection))}
                        download={formatSpeed(getDownloadSpeed(connection))}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TrafficPair
                        upload={formatBytes(getUploadTotal(connection))}
                        download={formatBytes(getDownloadTotal(connection))}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<X size={15} />}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeConnection.mutate(connection.id);
                        }}
                      >
                        关闭
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
      <ConnectionDetailDialog
        connection={selectedConnection}
        onClose={() => setSelectedConnection(null)}
      />
    </Box>
  );
}

function ProcessFilterButton({
  summary,
  active,
  pinned = false,
  onClick,
}: {
  summary: ProcessSummary;
  active: boolean;
  pinned?: boolean;
  onClick: () => void;
}) {
  const showMetrics = !pinned;

  return (
    <Button
      variant={active ? "contained" : "outlined"}
      onClick={onClick}
      sx={{
        justifyContent: "stretch",
        minHeight: showMetrics ? 82 : 48,
        px: 1.25,
        py: 1,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} width="100%" minWidth={0}>
        <Box
          width={30}
          height={30}
          borderRadius={1}
          display="grid"
          flexShrink={0}
          sx={{ placeItems: "center" }}
          bgcolor={active ? "rgba(255,255,255,0.18)" : "action.hover"}
        >
          <Radio size={15} />
        </Box>
        <Box flex={1} minWidth={0} textAlign="left">
          <Stack direction="row" alignItems="center" spacing={1} minWidth={0}>
            <Typography flex={1} fontWeight={800} noWrap>
              {summary.name}
            </Typography>
            <Chip
              size="small"
              label={summary.count}
              color={active ? "default" : "primary"}
              sx={{ bgcolor: active ? "rgba(255,255,255,0.18)" : undefined }}
            />
          </Stack>
          {showMetrics ? (
            <Typography
              component="div"
              color={active ? "inherit" : "text.secondary"}
              fontSize={11}
              mt={0.5}
              sx={{ opacity: active ? 0.88 : 1 }}
            >
              <Stack spacing={0.25}>
                <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                  <Box
                    component="span"
                    flex={1}
                    minWidth={0}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                  >
                    上传总量 {formatBytes(summary.uploadTotal)}
                  </Box>
                  <Box
                    component="span"
                    flex={1}
                    minWidth={0}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                  >
                    下载总量 {formatBytes(summary.downloadTotal)}
                  </Box>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                  <Box component="span" flex={1} minWidth={0}>
                    <MetricIconValue
                      title="实时上传速度"
                      value={formatSpeed(summary.uploadSpeed)}
                      icon={<UploadCloud size={12} />}
                    />
                  </Box>
                  <Box component="span" flex={1} minWidth={0}>
                    <MetricIconValue
                      title="实时下载速度"
                      value={formatSpeed(summary.downloadSpeed)}
                      icon={<Download size={12} />}
                    />
                  </Box>
                </Stack>
              </Stack>
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </Button>
  );
}

function ConnectionDetailDialog({
  connection,
  onClose,
}: {
  connection: ConnectionSummary | null;
  onClose: () => void;
}) {
  if (!connection) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
          <Stack direction="row" alignItems="center" spacing={1.25} minWidth={0}>
            <CountryFlag
              countryCode={connection.destination_country_code}
              country={connection.destination_country}
            />
            <Box minWidth={0}>
              <Typography fontWeight={900} noWrap>
                {connection.destination_address ?? connection.host}
              </Typography>
              <Typography color="text.secondary" fontSize={13} noWrap>
                {[connection.destination_country, getConnectionType(connection), connection.network.toUpperCase()]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
            </Box>
          </Stack>
          <IconButton aria-label="关闭详情" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box display="grid" gridTemplateColumns={{ xs: "1fr", md: "1fr 1fr" }} gap={2}>
          <DetailGroup title="地址信息">
            <DetailRow label="源地址" value={connection.source_address ?? "未知源地址"} />
            <DetailRow label="目标地址" value={connection.destination_address ?? connection.host} />
            <DetailRow label="目标域名" value={connection.destination_domain ?? connection.host} />
            <DetailRow label="目标 IP" value={connection.destination_ip ?? "未知 IP"} />
            <DetailRow label="所属国家" value={connection.destination_country ?? "未知国家"} />
          </DetailGroup>

          <DetailGroup title="连接信息">
            <DetailRow label="连接类型" value={getConnectionType(connection)} />
            <DetailRow label="网络协议" value={connection.network.toUpperCase()} />
            <DetailRow label="规则" value={connection.rule} />
            <DetailRow label="链路" value={connection.chain.join(" / ")} />
            <DetailRow label="创建时间" value={connection.created_at} />
          </DetailGroup>

          <DetailGroup title="进程信息">
            <DetailRow label="进程名称" value={connection.process} />
            <DetailRow label="进程路径" value={connection.process_path ?? "未知路径"} />
          </DetailGroup>

          <DetailGroup title="流量信息">
            <DetailRow label="实时上传" value={formatSpeed(getUploadSpeed(connection))} />
            <DetailRow label="实时下载" value={formatSpeed(getDownloadSpeed(connection))} />
            <DetailRow label="上传总量" value={formatBytes(getUploadTotal(connection))} />
            <DetailRow label="下载总量" value={formatBytes(getDownloadTotal(connection))} />
          </DetailGroup>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Typography fontWeight={900} mb={1}>
        {title}
      </Typography>
      <Stack divider={<Divider flexItem />} border="1px solid" borderColor="divider" borderRadius={1}>
        {children}
      </Stack>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2} px={1.25} py={1}>
      <Typography color="text.secondary" flexShrink={0}>
        {label}
      </Typography>
      <Typography fontWeight={700} textAlign="right" sx={{ overflowWrap: "anywhere" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function CountryFlag({
  countryCode,
  country,
}: {
  countryCode?: string;
  country?: string;
}) {
  const flag = getFlagEmoji(countryCode);

  return (
    <Tooltip title={country ?? countryCode ?? "未知国家"}>
      <Box
        width={30}
        height={30}
        borderRadius="50%"
        display="grid"
        flexShrink={0}
        overflow="hidden"
        border="1px solid"
        borderColor="divider"
        bgcolor="background.default"
        sx={{ fontSize: 19, lineHeight: 1, placeItems: "center" }}
      >
        {flag}
      </Box>
    </Tooltip>
  );
}

function TrafficPair({ upload, download }: { upload: string; download: string }) {
  return (
    <Stack spacing={0.5} alignItems="flex-end">
      <MetricIconValue title="上传" value={upload} icon={<UploadCloud size={13} />} />
      <MetricIconValue title="下载" value={download} icon={<Download size={13} />} />
    </Stack>
  );
}

function MetricIconValue({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <Box component="span" display="inline-flex" alignItems="center" gap={0.35} whiteSpace="nowrap">
        {icon}
        <Box component="span">{value}</Box>
      </Box>
    </Tooltip>
  );
}

function getUploadSpeed(connection: ConnectionSummary) {
  return connection.upload_speed ?? connection.upload;
}

function getDownloadSpeed(connection: ConnectionSummary) {
  return connection.download_speed ?? connection.download;
}

function getUploadTotal(connection: ConnectionSummary) {
  return connection.upload_total ?? connection.upload;
}

function getDownloadTotal(connection: ConnectionSummary) {
  return connection.download_total ?? connection.download;
}

function getConnectionType(connection: ConnectionSummary) {
  return (connection.connection_type ?? connection.network).toUpperCase();
}

function getFlagEmoji(countryCode?: string) {
  if (!countryCode || countryCode.length !== 2) return "🌐";

  const normalizedCode = countryCode.toUpperCase();
  const firstLetter = normalizedCode.charCodeAt(0);
  const secondLetter = normalizedCode.charCodeAt(1);
  const isValidCode =
    firstLetter >= 65 &&
    firstLetter <= 90 &&
    secondLetter >= 65 &&
    secondLetter <= 90;

  if (!isValidCode) return "🌐";

  return String.fromCodePoint(firstLetter + 127397, secondLetter + 127397);
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}

function formatSpeed(value: number) {
  return `${formatBytes(value)}/s`;
}
