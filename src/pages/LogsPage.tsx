import { useMemo, useState } from "react";
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

export function LogsPage() {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const { logs, clearLogs, refreshRuntimeData } = useAppStore();
  const visibleLogs = useMemo(() => logs.filter((entry) => entry.source !== "测速"), [logs]);

  const filtered = useMemo(() => visibleLogs.filter((entry) =>
    `${entry.content}${entry.source}`.toLowerCase().includes(search.toLowerCase())
    && (level === "all" || entry.level === level)
    && (source === "all" || entry.source === source)
    && (showDebug || entry.level !== "DEBUG")), [level, search, showDebug, source, visibleLogs]);

  const copyLog = async (entry: LogEntry) => {
    const content = `[${entry.time}] [${entry.level}] [${entry.source}] ${entry.content}`;
    try { await navigator.clipboard.writeText(content); message.success("日志已复制"); }
    catch { message.info(content); }
  };

  const exportLogs = () => {
    const content = visibleLogs.map((entry) => `[${entry.time}] [${entry.level}] [${entry.source}] ${entry.content}`).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clash-mg-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    message.success("日志文件已导出");
  };

  const columns: TableColumnsType<LogEntry> = [
    { title: "时间", dataIndex: "time", width: 145 },
    { title: "级别", dataIndex: "level", width: 130, render: (value: LogLevel) => <Tag color={logColor[value]}>{value}</Tag> },
    { title: "来源", dataIndex: "source", width: 150 },
    { title: "内容", dataIndex: "content", ellipsis: true },
    { title: "操作", key: "actions", width: 110, render: (_, record) => <Space><Button type="text" icon={<CopyOutlined />} onClick={() => void copyLog(record)} aria-label="复制日志" /><Button type="text" icon={<UnorderedListOutlined />} onClick={() => setDetail(record)} aria-label="日志详情" /></Space> },
  ];

  return (
    <div className="page-stack logs-page">
      <PageHeader title="日志" description="查看运行日志、连接事件与系统状态，便于排查问题与监控运行情况。" actions={<><Button icon={<ExportOutlined />} onClick={exportLogs}>导出日志</Button><Button type="primary" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: "清空全部日志？", content: "此操作会清除当前本地日志记录。", okText: "清空", cancelText: "取消", okButtonProps: { danger: true }, onOk: clearLogs })}>清空日志</Button></>} />
      <Panel className="logs-panel">
        <div className="filter-bar logs-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索日志内容 / 进程 / 模块" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={level} onChange={setLevel} options={[{ label: "全部级别", value: "all" }, ...Object.keys(logColor).map((value) => ({ label: value, value }))]} />
          <Select value={source} onChange={setSource} options={[{ label: "全部来源", value: "all" }, ...Array.from(new Set(visibleLogs.map((entry) => entry.source))).map((value) => ({ label: value, value }))]} />
          <Flex align="center" gap={8} className="filter-switch"><Text>自动滚动</Text><Switch checked={autoScroll} onChange={setAutoScroll} /></Flex>
          <Flex align="center" gap={8} className="filter-switch"><Text>显示调试</Text><Switch checked={showDebug} onChange={setShowDebug} /></Flex>
          <Button icon={<ReloadOutlined />} onClick={() => { void refreshRuntimeData(); message.success("已请求刷新运行日志"); }} aria-label="刷新日志" />
          <Button icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />} onClick={() => { setPaused(!paused); message.info(paused ? "已继续接收日志" : "已暂停接收日志"); }} aria-label={paused ? "继续" : "暂停"} />
        </div>
        {paused && <div className="paused-banner"><PauseOutlined /> 日志流已暂停，现有内容仍可筛选和查看。</div>}
        <Table<LogEntry>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 880 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: <div className="empty-logs"><FileTextOutlined /><span>暂无日志</span></div> }}
          onRow={(record) => ({ onDoubleClick: () => void copyLog(record) })}
        />
      </Panel>

      <Modal open={Boolean(detail)} onCancel={() => setDetail(null)} title="日志详情" footer={<><Button icon={<CopyOutlined />} onClick={() => detail && void copyLog(detail)}>复制日志</Button><Button type="primary" onClick={() => setDetail(null)}>关闭</Button></>} width={680}>
        {detail && <Descriptions bordered column={1} items={[{ key: "time", label: "时间", children: detail.time }, { key: "level", label: "级别", children: <Tag color={logColor[detail.level]}>{detail.level}</Tag> }, { key: "source", label: "来源", children: detail.source }, { key: "content", label: "内容", children: detail.content }, { key: "raw", label: "原始记录", children: <code>[{detail.time}] [{detail.level}] [{detail.source}] {detail.content}</code> }]} />}
      </Modal>
    </div>
  );
}
