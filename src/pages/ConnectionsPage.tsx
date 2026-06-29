import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Checkbox, Flex, Input, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { TableColumnsType } from "antd";
import { PageHeader, Panel, StatusDot } from "../components/Common";
import { ProcessIcon } from "../components/ProcessIcon";
import { useAppStore } from "../store/useAppStore";
import type { Connection } from "../types";
import { isTauriRuntime } from "../utils/tauri";
import {
  calculateConnectionRates,
  durationToSeconds,
  formatByteRate,
  type ConnectionRate,
  type ConnectionTrafficSample,
} from "../utils/connectionTraffic";

const { Text } = Typography;
const emptyRate: ConnectionRate = { upload: 0, download: 0 };
const compareText = (current: string, next: string) => current.localeCompare(next, "zh-CN", { numeric: true, sensitivity: "base" });
const refreshIntervalOptions = [
  { label: "1 秒", value: 1000 },
  { label: "3 秒", value: 3000 },
  { label: "5 秒", value: 5000 },
  { label: "10 秒", value: 10000 },
];

export function ConnectionsPage() {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [status, setStatus] = useState("all");
  const [policy, setPolicy] = useState("all");
  const [processFilter, setProcessFilter] = useState("all");
  const [onlyActive, setOnlyActive] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(3000);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [connectionRates, setConnectionRates] = useState<Record<string, ConnectionRate>>({});
  const [windowActive, setWindowActive] = useState(true);
  const trafficSampleRef = useRef<ConnectionTrafficSample | undefined>(undefined);
  const refreshingRef = useRef(false);
  const { connections, closeConnections, clearClosedConnections, refreshConnections, refreshRuntimeData } = useAppStore();

  const refreshConnectionData = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      await refreshConnections();
    } finally {
      refreshingRef.current = false;
    }
  }, [refreshConnections]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    const watchWindowFocus = async () => {
      if (!await isTauriRuntime()) return;

      const currentWindow = getCurrentWindow();
      const focused = await currentWindow.isFocused();
      if (mounted) setWindowActive(focused);

      const stopListening = await currentWindow.onFocusChanged(({ payload }) => {
        if (mounted) setWindowActive(payload);
      });
      if (mounted) {
        unlisten = stopListening;
      } else {
        stopListening();
      }
    };

    void watchWindowFocus();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!windowActive) return;
    void refreshConnectionData();
  }, [refreshConnectionData, windowActive]);

  useEffect(() => {
    if (!windowActive || !autoRefresh) return;
    const timer = window.setInterval(() => void refreshConnectionData(), refreshInterval);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshConnectionData, refreshInterval, windowActive]);

  useEffect(() => {
    const { rates, sample } = calculateConnectionRates(connections, Date.now(), trafficSampleRef.current);
    trafficSampleRef.current = sample;
    setConnectionRates(rates);
  }, [connections]);

  const processOptions = useMemo(() => [
    { label: "所有进程", value: "all" },
    ...Array.from(new Set(connections.map((connection) => connection.process)))
      .sort((current, next) => current.localeCompare(next))
      .map((value) => ({ label: value, value })),
  ], [connections]);

  const filtered = useMemo(() => connections.filter((connection) =>
    `${connection.app}${connection.process}${connection.processPath}${connection.target}${connection.ip}${connection.policy}${connection.node}${connection.chain.join("")}`.toLowerCase().includes(search.toLowerCase())
    && (protocol === "all" || connection.protocol === protocol)
    && (status === "all" || connection.status === status)
    && (policy === "all" || connection.policy === policy)
    && (processFilter === "all" || connection.process === processFilter)
    && (!onlyActive || connection.status === "活跃")), [connections, onlyActive, policy, processFilter, protocol, search, status]);

  useEffect(() => {
    setPage(1);
  }, [onlyActive, policy, processFilter, protocol, search, status]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
    setPage((current) => Math.min(current, lastPage));
  }, [filtered.length, pageSize]);

  const closeItems = async (ids: string[]) => {
    try {
      await closeConnections(ids);
      setSelectedIds([]);
      message.success(`已关闭 ${ids.length} 个连接`);
    } catch (error) {
      message.error(`关闭连接失败：${String(error)}`);
    }
  };

  const openConnectionDetail = async (connection: Connection) => {
    try {
      await invoke("open_connection_detail_window", {
        id: connection.id,
        title: `连接详情 - ${connection.app}`,
      });
    } catch (error) {
      console.error(error);
      message.error("连接详情窗口打开失败，请确认已在 Tauri 桌面环境中运行并重启应用");
    }
  };

  const columns: TableColumnsType<Connection> = [
    { title: "应用 / 进程", dataIndex: "app", width: 220, render: (value: string, record) => {
      const processDetail = record.processPath || (record.process !== value ? record.process : "");
      return <Flex gap={10} align="center" className="connection-process"><ProcessIcon app={value} icon={record.icon} /><span className="connection-process-copy"><strong title={value}>{value}</strong>{processDetail && <Text type="secondary" title={processDetail}>{processDetail}</Text>}</span></Flex>;
    }, sorter: (current, next) => compareText(`${current.app}${current.process}`, `${next.app}${next.process}`) },
    { title: "目标地址", dataIndex: "target", width: 205, sorter: (current, next) => compareText(`${current.target}${current.ip}`, `${next.target}${next.ip}`), render: (value: string, record) => <span className="stacked-cell"><strong>{value}</strong><Text type="secondary">{record.ip}</Text></span> },
    { title: "协议", dataIndex: "protocol", width: 80, sorter: (current, next) => compareText(current.protocol, next.protocol) },
    { title: "累计上传 / 下载", key: "traffic", width: 190, sorter: (current, next) => current.uploadBytes + current.downloadBytes - next.uploadBytes - next.downloadBytes, render: (_, record) => <span className="connection-traffic-cell"><span><i className="traffic-up">↑</i> {record.upload}</span><span><i className="traffic-down">↓</i> {record.download}</span></span> },
    { title: "实时上传 / 下载", key: "realtimeTraffic", width: 210, sorter: (current, next) => {
      const currentRate = connectionRates[current.id] ?? emptyRate;
      const nextRate = connectionRates[next.id] ?? emptyRate;
      return currentRate.upload + currentRate.download - nextRate.upload - nextRate.download;
    }, render: (_, record) => {
      const rate = connectionRates[record.id] ?? emptyRate;
      return <span className="connection-traffic-cell"><span><i className="traffic-up">↑</i> {formatByteRate(rate.upload)}</span><span><i className="traffic-down">↓</i> {formatByteRate(rate.download)}</span></span>;
    } },
    { title: "持续时间", dataIndex: "duration", width: 110, sorter: (current, next) => durationToSeconds(current.duration) - durationToSeconds(next.duration) },
    { title: "规则", dataIndex: "rule", width: 120, sorter: (current, next) => compareText(current.rule, next.rule), render: (value: string) => <Tag color={value === "广告拦截" ? "red" : value === "媒体分流" ? "green" : value === "ChatGPT" ? "purple" : "blue"}>{value}</Tag> },
    { title: "策略组", dataIndex: "policy", width: 140, sorter: (current, next) => compareText(current.policy, next.policy) },
    { title: "出口 / 物理入口", dataIndex: "node", width: 190, sorter: (current, next) => compareText(`${current.node}${current.entryNode}`, `${next.node}${next.entryNode}`), render: (value: string, record) => <span className="stacked-cell"><strong title={value}>{value}</strong>{record.entryNode && <Text type="secondary" title={record.entryNode}>入口：{record.entryNode}</Text>}</span> },
    { title: "状态", dataIndex: "status", width: 90, sorter: (current, next) => compareText(current.status, next.status), render: (value: Connection["status"]) => <StatusDot status={value === "活跃" ? "success" : "default"}>{value}</StatusDot> },
    { title: "操作", key: "actions", width: 100, fixed: "right", render: (_, record) => <Space><Button icon={<EyeOutlined />} onClick={() => void openConnectionDetail(record)} aria-label="查看详情" /><Button icon={<CloseCircleOutlined />} disabled={record.status === "已关闭"} onClick={() => void closeItems([record.id])} aria-label="关闭连接" /></Space> },
  ];

  return (
    <div className="page-stack connections-page">
      <PageHeader title="连接" description="查看与管理当前网络连接，分析流量去向与命中规则。" actions={<><Button icon={<ReloadOutlined />} onClick={() => { void refreshRuntimeData(); message.success("已请求刷新连接列表"); }}>刷新</Button><Button type="primary" icon={<DeleteOutlined />} onClick={() => { clearClosedConnections(); message.success("已清理关闭的连接"); }}>清理关闭连接</Button></>} />
      <Panel className="connections-panel">
        <div className="filter-bar connection-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索目标域名 / IP / 进程" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={protocol} onChange={setProtocol} options={[{ label: "所有协议", value: "all" }, { label: "TCP", value: "TCP" }, { label: "UDP", value: "UDP" }]} />
          <Select value={status} onChange={setStatus} options={[{ label: "所有状态", value: "all" }, { label: "活跃", value: "活跃" }, { label: "已关闭", value: "已关闭" }]} />
          <Select value={policy} onChange={setPolicy} options={[{ label: "所有策略组", value: "all" }, ...Array.from(new Set(connections.map((connection) => connection.policy))).map((value) => ({ label: value, value }))]} />
          <Select value={processFilter} onChange={setProcessFilter} options={processOptions} />
          <Flex gap={8} align="center" className="filter-switch"><Text>仅显示活跃</Text><Switch checked={onlyActive} onChange={setOnlyActive} /></Flex>
          <Flex gap={8} align="center" className="connection-refresh-controls">
            <Checkbox checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)}>自动刷新</Checkbox>
            <Select className="connection-refresh-interval" value={refreshInterval} onChange={setRefreshInterval} options={refreshIntervalOptions} disabled={!autoRefresh} aria-label="自动刷新间隔" />
          </Flex>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearch(""); setProtocol("all"); setStatus("all"); setPolicy("all"); setProcessFilter("all"); }} aria-label="重置筛选" />
        </div>
        {selectedIds.length > 0 && <div className="selection-action-bar"><span>已选择 {selectedIds.length} 个连接</span><Button danger size="small" icon={<CloseCircleOutlined />} onClick={() => void closeItems(selectedIds)}>关闭所选连接</Button></div>}
        <Table<Connection>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 1670 }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            },
          }}
        />
      </Panel>

    </div>
  );
}
