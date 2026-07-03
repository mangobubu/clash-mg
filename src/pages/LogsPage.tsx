import { useEffect, useMemo, useState } from "react";
import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileTextOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, Descriptions, Flex, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { TableColumnsType } from "antd";
import { PageHeader, Panel } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { LogEntry, LogLevel } from "../types";

const { Text } = Typography;

const logColor: Record<LogLevel, string> = { DEBUG: "default", INFO: "blue", SUCCESS: "green", WARNING: "orange", ERROR: "red" };
const logRank: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, SUCCESS: 2, WARNING: 3, ERROR: 4 };

interface DisplayLogEntry extends LogEntry {
  repeatCount?: number;
}

function normalizeLogLevel(value: unknown): LogLevel {
  const text = String(value ?? "Info");
  if (text.includes("Debug") || text.includes("调试")) return "DEBUG";
  if (text.includes("Warning") || text.includes("警告")) return "WARNING";
  if (text.includes("Error") || text.includes("错误")) return "ERROR";
  return "INFO";
}

function splitKeywords(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function shouldRecordLog(entry: LogEntry, settings: Record<string, unknown>) {
  const source = entry.source.toUpperCase();
  const content = entry.content.toUpperCase();
  if (entry.source === "连接") return settings.recordConnections !== false;
  if (entry.source === "代理") return settings.recordProxySwitch !== false;
  if (entry.source === "规则" || entry.content.includes("规则")) return settings.recordRules !== false;
  if (source.includes("DNS") || content.includes("DNS")) return settings.recordDns !== false;
  if (source.includes("TUN") || content.includes("TUN")) return settings.recordTun !== false;
  return true;
}

function collapseDuplicateLogs(entries: LogEntry[]): DisplayLogEntry[] {
  const collapsed: DisplayLogEntry[] = [];
  const indexBySignature = new Map<string, number>();

  for (const entry of entries) {
    const signature = `${entry.level}\n${entry.source}\n${entry.content}`;
    const existingIndex = indexBySignature.get(signature);
    if (existingIndex === undefined) {
      indexBySignature.set(signature, collapsed.length);
      collapsed.push({ ...entry, repeatCount: 1 });
      continue;
    }
    collapsed[existingIndex] = {
      ...collapsed[existingIndex],
      repeatCount: (collapsed[existingIndex].repeatCount ?? 1) + 1,
    };
  }

  return collapsed;
}

function formatLog(entry: LogEntry, settings: Record<string, unknown>) {
  const parts = [
    settings.timestamp !== false ? `[${entry.time}]` : "",
    `[${entry.level}]`,
    settings.showSource !== false ? `[${entry.source}]` : "",
    entry.content,
  ].filter(Boolean);
  return parts.join(" ");
}

export function LogsPage() {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [autoScroll, setAutoScroll] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pausedLogs, setPausedLogs] = useState<LogEntry[] | null>(null);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const { logs, settings, updateSetting, clearLogs, refreshRuntimeData } = useAppStore();
  const minLevel = normalizeLogLevel(settings.logLevel);
  const visibleLogs = useMemo(() => {
    const includeKeywords = splitKeywords(settings.filterKeywords);
    const excludeKeywords = splitKeywords(settings.excludeKeywords);
    const sourceLogs = paused && pausedLogs ? pausedLogs : logs;
    const prepared = sourceLogs.filter((entry) => {
      const haystack = `${entry.content}${entry.source}${entry.level}`.toLowerCase();
      return entry.source !== "测速"
        && shouldRecordLog(entry, settings)
        && logRank[entry.level] >= logRank[minLevel]
        && (includeKeywords.length === 0 || includeKeywords.some((keyword) => haystack.includes(keyword)))
        && !excludeKeywords.some((keyword) => haystack.includes(keyword));
    });
    return settings.collapseDuplicates ? collapseDuplicateLogs(prepared) : prepared;
  }, [logs, minLevel, paused, pausedLogs, settings]);

  useEffect(() => {
    setAutoScroll(settings.realtimeScroll !== false);
  }, [settings.realtimeScroll]);

  const filtered = useMemo(() => visibleLogs.filter((entry) =>
    `${entry.content}${entry.source}`.toLowerCase().includes(search.toLowerCase())
    && (level === "all" || entry.level === level)
    && (source === "all" || entry.source === source)), [level, search, source, visibleLogs]);
  const configuredMaxRows = Number(settings.maxLogRows ?? 1000);
  const maxRows = Number.isFinite(configuredMaxRows) ? Math.max(100, configuredMaxRows) : 1000;
  const dataSource = filtered.slice(0, maxRows);

  const copyLog = async (entry: LogEntry) => {
    const content = formatLog(entry, settings);
    try { await navigator.clipboard.writeText(content); message.success("日志已复制"); }
    catch { message.info(content); }
  };

  const exportLogs = () => {
    const jsonOutput = settings.logOutput === "JSON";
    const content = jsonOutput
      ? JSON.stringify(dataSource, null, 2)
      : dataSource.map((entry) => formatLog(entry, settings)).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: jsonOutput ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clash-mg-logs-${new Date().toISOString().slice(0, 10)}.${jsonOutput ? "json" : "txt"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    message.success("日志文件已导出");
  };

  const togglePaused = () => {
    if (paused) {
      setPaused(false);
      setPausedLogs(null);
      message.info("已继续接收日志");
      return;
    }
    setPausedLogs(logs);
    setPaused(true);
    message.info("已暂停接收日志");
  };

  const columns = [
    settings.timestamp !== false && { title: "时间", dataIndex: "time", width: 145 },
    { title: "级别", dataIndex: "level", width: 130, render: (value: LogLevel) => settings.showLevelTags === false ? value : <Tag color={settings.colorLogs === false ? "default" : logColor[value]}>{value}</Tag> },
    settings.showSource !== false && { title: "来源", dataIndex: "source", width: 150 },
    { title: "内容", dataIndex: "content", ellipsis: true, render: (value: string, record: DisplayLogEntry) => <span>{value}{(record.repeatCount ?? 1) > 1 && <Tag color="cyan">重复 {record.repeatCount} 次</Tag>}</span> },
    { title: "操作", key: "actions", width: 110, render: (_: unknown, record: DisplayLogEntry) => <Space><Button type="text" icon={<CopyOutlined />} onClick={() => void copyLog(record)} aria-label="复制日志" /><Button type="text" icon={<UnorderedListOutlined />} onClick={() => setDetail(record)} aria-label="日志详情" /></Space> },
  ].filter(Boolean) as TableColumnsType<DisplayLogEntry>;

  return (
    <div className="page-stack logs-page">
      <PageHeader title="日志" description="查看运行日志、连接事件与系统状态，便于排查问题与监控运行情况。" actions={<><Button icon={<ExportOutlined />} onClick={exportLogs}>导出日志</Button><Button type="primary" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: "清空全部日志？", content: "此操作会清除当前本地日志记录。", okText: "清空", cancelText: "取消", okButtonProps: { danger: true }, onOk: clearLogs })}>清空日志</Button></>} />
      <Panel className="logs-panel">
        <div className="filter-bar logs-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索日志内容 / 进程 / 模块" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={level} onChange={setLevel} options={[{ label: "全部级别", value: "all" }, ...Object.keys(logColor).map((value) => ({ label: value, value }))]} />
          <Select value={source} onChange={setSource} options={[{ label: "全部来源", value: "all" }, ...Array.from(new Set(visibleLogs.map((entry) => entry.source))).map((value) => ({ label: value, value }))]} />
          <Flex align="center" gap={8} className="filter-switch"><Text>自动滚动</Text><Switch checked={autoScroll} onChange={(checked) => updateSetting("realtimeScroll", checked)} /></Flex>
          <Flex align="center" gap={8} className="filter-switch"><Text>显示调试</Text><Switch checked={minLevel === "DEBUG"} onChange={(checked) => updateSetting("logLevel", checked ? "Debug" : "Info")} /></Flex>
          <Button icon={<ReloadOutlined />} onClick={() => { void refreshRuntimeData(); message.success("已请求刷新运行日志"); }} aria-label="刷新日志" />
          <Button icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />} onClick={togglePaused} aria-label={paused ? "继续" : "暂停"} />
        </div>
        {paused && <div className="paused-banner"><PauseOutlined /> 日志流已暂停，现有内容仍可筛选和查看。</div>}
        <Table<DisplayLogEntry>
          rowKey="id"
          columns={columns}
          dataSource={dataSource}
          scroll={{ x: 880 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: <div className="empty-logs"><FileTextOutlined /><span>暂无日志</span></div> }}
          onRow={(record) => settings.doubleClickCopy === false ? {} : { onDoubleClick: () => void copyLog(record) }}
        />
      </Panel>

      <Modal open={Boolean(detail)} onCancel={() => setDetail(null)} title="日志详情" footer={<><Button icon={<CopyOutlined />} onClick={() => detail && void copyLog(detail)}>复制日志</Button><Button type="primary" onClick={() => setDetail(null)}>关闭</Button></>} width={680}>
        {detail && <Descriptions bordered column={1} items={[{ key: "time", label: "时间", children: detail.time }, { key: "level", label: "级别", children: <Tag color={settings.colorLogs === false ? "default" : logColor[detail.level]}>{detail.level}</Tag> }, { key: "source", label: "来源", children: detail.source }, { key: "content", label: "内容", children: detail.content }, { key: "raw", label: "原始记录", children: <code>{settings.logOutput === "JSON" ? JSON.stringify(detail) : formatLog(detail, settings)}</code> }]} />}
      </Modal>
    </div>
  );
}
