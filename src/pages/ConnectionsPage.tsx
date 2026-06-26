import { useMemo, useState } from "react";
import {
  CloseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { Button, Flex, Input, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { TableColumnsType } from "antd";
import { PageHeader, Panel, StatusDot } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { Connection } from "../types";

const { Text } = Typography;

export function ConnectionsPage() {
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [status, setStatus] = useState("all");
  const [policy, setPolicy] = useState("all");
  const [processFilter, setProcessFilter] = useState("all");
  const [onlyActive, setOnlyActive] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { connections, closeConnections, clearClosedConnections } = useAppStore();

  const processOptions = useMemo(() => [
    { label: "所有进程", value: "all" },
    ...Array.from(new Set(connections.map((connection) => connection.process)))
      .sort((current, next) => current.localeCompare(next))
      .map((value) => ({ label: value, value })),
  ], [connections]);

  const filtered = useMemo(() => connections.filter((connection) =>
    `${connection.app}${connection.process}${connection.target}${connection.ip}`.toLowerCase().includes(search.toLowerCase())
    && (protocol === "all" || connection.protocol === protocol)
    && (status === "all" || connection.status === status)
    && (policy === "all" || connection.policy === policy)
    && (processFilter === "all" || connection.process === processFilter)
    && (!onlyActive || connection.status === "活跃")), [connections, onlyActive, policy, processFilter, protocol, search, status]);

  const closeItems = (ids: string[]) => {
    closeConnections(ids);
    setSelectedIds([]);
    message.success(`已关闭 ${ids.length} 个连接`);
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
    { title: "应用 / 进程", dataIndex: "app", width: 190, render: (value: string, record) => <Flex gap={10} align="center"><span className="app-process-icon">{record.icon}</span><span><strong>{value}</strong><Text type="secondary">{record.process}</Text></span></Flex> },
    { title: "目标地址", dataIndex: "target", width: 205, render: (value: string, record) => <span className="stacked-cell"><strong>{value}</strong><Text type="secondary">{record.ip}</Text></span> },
    { title: "协议", dataIndex: "protocol", width: 80 },
    { title: "上传 / 下载", key: "traffic", width: 150, render: (_, record) => <span><i className="traffic-down">↓</i> {record.upload} <i className="traffic-up">↑</i> {record.download}</span> },
    { title: "持续时间", dataIndex: "duration", width: 110 },
    { title: "规则", dataIndex: "rule", width: 120, render: (value: string) => <Tag color={value === "广告拦截" ? "red" : value === "媒体分流" ? "green" : value === "ChatGPT" ? "purple" : "blue"}>{value}</Tag> },
    { title: "策略组", dataIndex: "policy", width: 140 },
    { title: "状态", dataIndex: "status", width: 90, render: (value: Connection["status"]) => <StatusDot status={value === "活跃" ? "success" : "default"}>{value}</StatusDot> },
    { title: "操作", key: "actions", width: 100, fixed: "right", render: (_, record) => <Space><Button icon={<EyeOutlined />} onClick={() => void openConnectionDetail(record)} aria-label="查看详情" /><Button icon={<CloseCircleOutlined />} disabled={record.status === "已关闭"} onClick={() => closeItems([record.id])} aria-label="关闭连接" /></Space> },
  ];

  return (
    <div className="page-stack connections-page">
      <PageHeader title="连接" description="查看与管理当前网络连接，分析流量去向与命中规则。" actions={<><Button icon={<ReloadOutlined />} onClick={() => message.success("连接列表已刷新")}>刷新</Button><Button type="primary" icon={<DeleteOutlined />} onClick={() => { clearClosedConnections(); message.success("已清理关闭的连接"); }}>清理关闭连接</Button></>} />
      <Panel className="connections-panel">
        <div className="filter-bar connection-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索目标域名 / IP / 进程" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={protocol} onChange={setProtocol} options={[{ label: "所有协议", value: "all" }, { label: "TCP", value: "TCP" }, { label: "UDP", value: "UDP" }]} />
          <Select value={status} onChange={setStatus} options={[{ label: "所有状态", value: "all" }, { label: "活跃", value: "活跃" }, { label: "已关闭", value: "已关闭" }]} />
          <Select value={policy} onChange={setPolicy} options={[{ label: "所有策略组", value: "all" }, ...Array.from(new Set(connections.map((connection) => connection.policy))).map((value) => ({ label: value, value }))]} />
          <Select value={processFilter} onChange={setProcessFilter} options={processOptions} />
          <Flex gap={8} align="center" className="filter-switch"><Text>仅显示活跃</Text><Switch checked={onlyActive} onChange={setOnlyActive} /></Flex>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearch(""); setProtocol("all"); setStatus("all"); setPolicy("all"); setProcessFilter("all"); }} aria-label="重置筛选" />
        </div>
        {selectedIds.length > 0 && <div className="selection-action-bar"><span>已选择 {selectedIds.length} 个连接</span><Button danger size="small" icon={<CloseCircleOutlined />} onClick={() => closeItems(selectedIds)}>关闭所选连接</Button></div>}
        <Table<Connection>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 1240 }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        />
      </Panel>

    </div>
  );
}
