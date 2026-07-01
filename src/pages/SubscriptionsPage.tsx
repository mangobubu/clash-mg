import { useMemo, useRef, useState } from "react";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import { HintBar, PageHeader, Panel, StatusDot } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { Subscription, SubscriptionType } from "../types";

const { Text, Title } = Typography;
const { TextArea } = Input;

function parseRequestHeaders(value?: string): Record<string, string> {
  if (!value?.trim()) return {};
  return Object.fromEntries(value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) throw new Error(`请求头格式无效：${line}`);
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }).filter(([name]) => Boolean(name)));
}

function formatRequestHeaders(headers: Record<string, string>) {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n");
}

interface SubscriptionFormValues {
  type: SubscriptionType;
  name: string;
  url: string;
  description?: string;
  userAgent?: string;
  headers?: string;
  autoUpdate: boolean;
  updateInterval: number;
  proxyUpdate: boolean;
  enabled: boolean;
  allowOverride: boolean;
  healthCheck: boolean;
  testUrl: string;
  format: string;
  tags?: string;
  nodeNameRule?: string;
  preview: boolean;
}

type RefreshOrigin = "single" | "batch";

interface SubscriptionRefreshState {
  origin: RefreshOrigin;
  ids: string[];
}

export function SubscriptionsPage() {
  const [quickUrl, setQuickUrl] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<SubscriptionRefreshState | null>(null);
  const refreshLockRef = useRef(false);
  const [form] = Form.useForm<SubscriptionFormValues>();
  const { subscriptions, addSubscription, updateSubscription, deleteSubscription, refreshSubscriptions } = useAppStore();

  const filtered = useMemo(() => subscriptions.filter((subscription) =>
    `${subscription.name}${subscription.url}`.toLowerCase().includes(search.toLowerCase())
    && (typeFilter === "all" || subscription.type === typeFilter)
    && (statusFilter === "all" || subscription.status === statusFilter)), [search, statusFilter, subscriptions, typeFilter]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: "HTTP", autoUpdate: true, updateInterval: 12, proxyUpdate: true, enabled: true, allowOverride: false, healthCheck: true, testUrl: "https://www.gstatic.com/generate_204", format: "Clash Meta (YAML)", preview: true });
    setModalOpen(true);
  };

  const openEdit = (subscription: Subscription) => {
    setEditing(subscription);
    form.setFieldsValue({
      type: subscription.type, name: subscription.name, url: subscription.url, description: subscription.description,
      userAgent: subscription.userAgent, headers: formatRequestHeaders(subscription.headers),
      autoUpdate: subscription.autoUpdate, updateInterval: subscription.updateInterval, proxyUpdate: subscription.proxyUpdate,
      enabled: subscription.enabled, allowOverride: subscription.allowOverride, healthCheck: subscription.healthCheck,
      testUrl: subscription.testUrl, format: "Clash Meta (YAML)", tags: subscription.tags.join(", "), preview: true,
    });
    setModalOpen(true);
  };

  const saveSubscription = async () => {
    const values = await form.validateFields();
    let headers: Record<string, string>;
    try {
      headers = parseRequestHeaders(values.headers);
    } catch (error) {
      message.error(String(error));
      return;
    }
    const subscription: Subscription = {
      id: editing?.id ?? crypto.randomUUID(),
      name: values.name,
      type: values.type,
      url: values.url,
      nodeCount: editing?.nodeCount ?? 0,
      lastUpdated: editing?.lastUpdated ?? "尚未更新",
      updateInterval: values.updateInterval,
      status: values.enabled ? "正常" : "已禁用",
      enabled: values.enabled,
      autoUpdate: values.autoUpdate,
      proxyUpdate: values.proxyUpdate,
      allowOverride: values.allowOverride,
      userAgent: values.userAgent?.trim() || undefined,
      headers,
      healthCheck: values.healthCheck,
      testUrl: values.testUrl.trim(),
      lastUpdatedAt: editing?.lastUpdatedAt,
      description: values.description,
      usedTraffic: editing?.usedTraffic ?? "0 B",
      expiresAt: editing?.expiresAt ?? "未知",
      tags: values.tags?.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) ?? [],
    };
    if (editing) updateSubscription(subscription); else addSubscription(subscription);
    setModalOpen(false);
    message.success(editing ? "订阅已保存" : "订阅已创建");
  };

  const importQuickLink = () => {
    if (!/^https?:\/\//i.test(quickUrl.trim())) {
      message.warning("请输入有效的 HTTP/HTTPS 订阅链接");
      return;
    }
    addSubscription({ id: crypto.randomUUID(), name: `快速订阅 ${subscriptions.length + 1}`, type: "HTTP", url: quickUrl.trim(), nodeCount: 0, lastUpdated: "尚未更新", updateInterval: 12, status: "正常", enabled: true, autoUpdate: true, proxyUpdate: true, allowOverride: false, headers: {}, healthCheck: true, testUrl: "https://www.gstatic.com/generate_204", usedTraffic: "0 B", expiresAt: "未知", tags: ["快速导入"] });
    setQuickUrl("");
    message.success("订阅链接已保存，点击“立即更新”后将校验并应用到 Mihomo");
  };

  const handleDelete = async (subscription: Subscription) => {
    if (deletingId) return;
    setDeletingId(subscription.id);
    try {
      await deleteSubscription(subscription.id);
      setSelectedIds((ids) => ids.filter((id) => id !== subscription.id));
      if (detail?.id === subscription.id) setDetail(null);
      message.success(`已删除订阅“${subscription.name}”及其关联代理组、节点和规则`);
    } catch (error) {
      message.error(`删除订阅失败：${String(error)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefreshSubscriptions = async (ids: string[] | undefined, origin: RefreshOrigin) => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setRefreshState({ origin, ids: ids ?? subscriptions.map((subscription) => subscription.id) });

    try {
      const result = await refreshSubscriptions(ids);
      if (detail) {
        const latest = useAppStore.getState().subscriptions.find((subscription) => subscription.id === detail.id);
        if (latest) setDetail(latest);
      }

      if (result.failed && result.updated) {
        message.warning(`已更新并应用 ${result.updated} 项订阅，${result.failed} 项失败`);
        return;
      }
      if (result.failed) {
        message.error(result.messages.join("；") || "订阅更新失败");
        return;
      }
      if (result.updated) {
        message.success(`已更新并应用 ${result.updated} 项订阅`);
        return;
      }

      message.info(result.messages[0] ?? "没有需要更新的订阅");
    } catch (error) {
      message.error(`订阅更新失败：${String(error)}`);
    } finally {
      refreshLockRef.current = false;
      setRefreshState(null);
    }
  };

  const isSingleRefreshing = (id: string) =>
    refreshState?.origin === "single" && refreshState.ids.includes(id);

  const columns: TableColumnsType<Subscription> = [
    { title: "订阅名称", dataIndex: "name", width: 190, render: (value: string, record) => <button className="table-primary-button" onClick={() => setDetail(record)}>{value}</button> },
    { title: "类型", dataIndex: "type", width: 110, render: (value: SubscriptionType) => <Tag color={value === "HTTP" ? "blue" : "purple"}>{value}</Tag> },
    { title: "URL / 地址", dataIndex: "url", ellipsis: true },
    { title: "节点数", dataIndex: "nodeCount", width: 92, align: "center" },
    { title: "上次更新", dataIndex: "lastUpdated", width: 120 },
    { title: "自动更新", dataIndex: "updateInterval", width: 110, render: (value: number, record) => record.autoUpdate ? `${value} 小时` : "手动" },
    { title: "状态", dataIndex: "status", width: 110, render: (value: Subscription["status"]) => <StatusDot status={value === "正常" ? "success" : value === "更新失败" ? "error" : "default"}>{value}</StatusDot> },
    {
      title: "操作", key: "actions", width: 150, fixed: "right",
      render: (_, record) => <Space onClick={(event) => event.stopPropagation()}>
        <Button type="text" icon={<ReloadOutlined />} loading={isSingleRefreshing(record.id)} disabled={Boolean(refreshState) && !isSingleRefreshing(record.id)} onClick={() => void handleRefreshSubscriptions([record.id], "single")} aria-label="立即更新" />
        <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} aria-label="编辑订阅" />
        <Dropdown disabled={Boolean(deletingId)} menu={{ items: [{ key: "copy", icon: <CopyOutlined />, label: "复制订阅" }, { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true }], onClick: ({ key }) => key === "delete" ? void handleDelete(record) : navigator.clipboard.writeText(record.url).then(() => message.success("订阅链接已复制")) }}>
          <Button type="text" icon={<MoreOutlined />} loading={deletingId === record.id} aria-label="更多操作" />
        </Dropdown>
      </Space>,
    },
  ];

  return (
    <div className="page-stack subscriptions-page">
      <PageHeader title="订阅" description="管理订阅源、更新配置并同步节点。" actions={<><Button icon={<ReloadOutlined />} loading={refreshState?.origin === "batch"} disabled={Boolean(refreshState) && refreshState?.origin !== "batch"} onClick={() => void handleRefreshSubscriptions(selectedIds.length ? selectedIds : undefined, "batch")}>批量更新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增订阅</Button></>} />

      <Panel className="quick-import-panel">
        <div className="quick-import-icon"><LinkOutlined /></div>
        <div className="quick-import-content">
          <Flex align="center" gap={10}><Title level={3}>快速导入订阅链接</Title><Tag color="green">推荐</Tag></Flex>
          <Flex gap={12}><Input size="large" placeholder="粘贴订阅链接，例如：https://sub.example.com/xxxx" value={quickUrl} onChange={(event) => setQuickUrl(event.target.value)} onPressEnter={importQuickLink} /><Button type="primary" size="large" onClick={importQuickLink}>导入链接</Button></Flex>
          <Text type="secondary">粘贴订阅链接后会保存为本地记录；点击更新将依次下载、校验并热重载 Mihomo 配置。</Text>
        </div>
      </Panel>

      <Panel className="subscription-list-panel" title={<Title level={3}>订阅列表</Title>}>
        <div className="filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索订阅名称 / URL" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={typeFilter} onChange={setTypeFilter} options={[{ label: "所有类型", value: "all" }, { label: "HTTP", value: "HTTP" }, { label: "文件导入", value: "文件导入" }, { label: "本地链接", value: "本地链接" }]} />
          <Select value={statusFilter} onChange={setStatusFilter} options={[{ label: "所有状态", value: "all" }, { label: "正常", value: "正常" }, { label: "更新失败", value: "更新失败" }, { label: "已禁用", value: "已禁用" }]} />
          <Button icon={<ReloadOutlined />} onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }} aria-label="重置筛选" />
        </div>
        <Table<Subscription>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 1120 }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          onRow={(record) => ({ onClick: () => setDetail(record) })}
        />
      </Panel>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void saveSubscription()} okText="保存" cancelText="取消" title={editing ? "编辑订阅" : "新增订阅"} width={860} className="form-modal" destroyOnHidden>
        <Form<SubscriptionFormValues> form={form} layout="vertical">
          <Panel title="1. 基本设置" className="modal-section">
            <div className="form-grid two-columns">
              <Form.Item label="类型" name="type"><Segmented block options={["HTTP", "文件导入", "本地链接"]} /></Form.Item>
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入订阅名称" }]}><Input placeholder="请输入订阅名称" /></Form.Item>
              <Form.Item label="订阅地址 / URL" name="url" rules={[{ required: true, message: "请输入订阅地址" }]}><Input placeholder="例如：https://sub.example.com/xxxx" /></Form.Item>
              <Form.Item label="说明 / 备注" name="description"><Input placeholder="可填写订阅来源、用途等说明" /></Form.Item>
              <Form.Item label="用户代理（可选）" name="userAgent"><Input placeholder="默认使用 Clash Meta 内置 UA" /></Form.Item>
              <Form.Item label="请求头（可选，每行一个）" name="headers"><TextArea rows={3} placeholder={"Authorization: Bearer token\nX-Client: clash-mg"} /></Form.Item>
              <Form.Item label="本地文件（可选）"><Upload beforeUpload={() => false} maxCount={1}><Button>选择配置文件</Button></Upload></Form.Item>
            </div>
          </Panel>
          <Panel title="2. 更新设置" className="modal-section">
            <div className="form-grid four-columns setting-form-grid">
              <Form.Item label="自动更新" name="autoUpdate" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="更新间隔（小时）" name="updateInterval"><InputNumber min={1} max={168} /></Form.Item>
              <Form.Item label="允许覆写节点" name="allowOverride" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="健康检查" name="healthCheck" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="代理更新" name="proxyUpdate" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="启用订阅" name="enabled" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="测试 URL" name="testUrl" className="span-two"><Input /></Form.Item>
            </div>
          </Panel>
          <Panel title="3. 解析 / 输出设置" className="modal-section"><div className="form-grid two-columns"><Form.Item label="配置格式" name="format"><Select options={[{ label: "Clash Meta (YAML)", value: "Clash Meta (YAML)" }, { label: "Clash Premium", value: "Clash Premium" }, { label: "通用 Base64", value: "Base64" }]} /></Form.Item><Form.Item label="标签 / 分组" name="tags"><Input placeholder="例如：机场, 国内, 海外" /></Form.Item><Form.Item label="节点命名规则（可选）" name="nodeNameRule"><Input placeholder="例如：{name}-{server}" /></Form.Item><Form.Item label="导入前预览" name="preview" valuePropName="checked"><Switch /></Form.Item></div></Panel>
          <HintBar>带 * 的字段为必填项，其他均为可选项。</HintBar>
          <Button icon={<ReloadOutlined />} onClick={() => message.info("订阅可用性以 Mihomo Provider 刷新结果为准")}>测试订阅</Button>
        </Form>
      </Modal>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={460} title="订阅详情">
        {detail && <div className="subscription-detail">
          <Flex justify="space-between" align="center"><Title level={3}>{detail.name}</Title><StatusDot status={detail.status === "正常" ? "success" : "error"}>{detail.status}</StatusDot></Flex>
          <Descriptions column={1} labelStyle={{ width: 100 }} items={[{ key: "url", label: "订阅地址", children: detail.url }, { key: "nodes", label: "节点数量", children: `${detail.nodeCount} 个` }, { key: "updated", label: "最后更新", children: detail.lastUpdated }, { key: "interval", label: "更新时间", children: detail.updateInterval ? `${detail.updateInterval} 小时` : "手动" }, { key: "traffic", label: "使用流量", children: detail.usedTraffic }, { key: "expires", label: "到期时间", children: detail.expiresAt }, { key: "format", label: "配置格式", children: "Clash Meta (YAML)" }]} />
          <Panel title="使用状态" className="detail-switches"><Flex vertical gap={16}><Flex justify="space-between">启用订阅<Switch checked={detail.enabled} onChange={(enabled) => { const next = { ...detail, enabled, status: enabled ? "正常" as const : "已禁用" as const }; updateSubscription(next); setDetail(next); }} /></Flex><Flex justify="space-between">自动更新<Switch checked={detail.autoUpdate} onChange={(autoUpdate) => { const next = { ...detail, autoUpdate }; updateSubscription(next); setDetail(next); }} /></Flex><Flex justify="space-between">代理更新<Switch checked={detail.proxyUpdate} onChange={(proxyUpdate) => { const next = { ...detail, proxyUpdate }; updateSubscription(next); setDetail(next); }} /></Flex></Flex></Panel>
          <Flex gap={12}><Button block icon={<EditOutlined />} onClick={() => { openEdit(detail); setDetail(null); }}>编辑订阅</Button><Button block type="primary" icon={<ReloadOutlined />} loading={isSingleRefreshing(detail.id)} disabled={Boolean(refreshState) && !isSingleRefreshing(detail.id)} onClick={() => void handleRefreshSubscriptions([detail.id], "single")}>立即更新</Button></Flex>
        </div>}
      </Drawer>
    </div>
  );
}
