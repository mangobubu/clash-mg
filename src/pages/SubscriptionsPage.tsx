import { useMemo, useState } from "react";
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

export function SubscriptionsPage() {
  const [quickUrl, setQuickUrl] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [detail, setDetail] = useState<Subscription | null>(null);
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
      autoUpdate: subscription.autoUpdate, updateInterval: subscription.updateInterval, proxyUpdate: subscription.proxyUpdate,
      enabled: subscription.enabled, allowOverride: subscription.allowOverride, healthCheck: true,
      testUrl: "https://www.gstatic.com/generate_204", format: "Clash Meta (YAML)", tags: subscription.tags.join(", "), preview: true,
    });
    setModalOpen(true);
  };

  const saveSubscription = async () => {
    const values = await form.validateFields();
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
    addSubscription({ id: crypto.randomUUID(), name: `快速订阅 ${subscriptions.length + 1}`, type: "HTTP", url: quickUrl.trim(), nodeCount: 0, lastUpdated: "尚未更新", updateInterval: 12, status: "正常", enabled: true, autoUpdate: true, proxyUpdate: true, allowOverride: false, usedTraffic: "0 B", expiresAt: "未知", tags: ["快速导入"] });
    setQuickUrl("");
    message.success("订阅链接已解析并添加");
  };

  const confirmDelete = (subscription: Subscription) => Modal.confirm({
    title: `删除订阅“${subscription.name}”？`,
    content: "此操作仅删除 Mock 数据，可通过重置浏览器存储恢复。",
    okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
    onOk: () => { deleteSubscription(subscription.id); if (detail?.id === subscription.id) setDetail(null); },
  });

  const columns: TableColumnsType<Subscription> = [
    { title: "订阅名称", dataIndex: "name", width: 190, render: (value: string, record) => <button className="table-primary-button" onClick={() => setDetail(record)}>{value}</button> },
    { title: "类型", dataIndex: "type", width: 110, render: (value: SubscriptionType) => <Tag color={value === "HTTP" ? "blue" : "purple"}>{value}</Tag> },
    { title: "URL / 地址", dataIndex: "url", ellipsis: true },
    { title: "节点数", dataIndex: "nodeCount", width: 92, align: "center" },
    { title: "上次更新", dataIndex: "lastUpdated", width: 120 },
    { title: "自动更新", dataIndex: "updateInterval", width: 110, render: (value: number) => value ? `${value} 小时` : "手动" },
    { title: "状态", dataIndex: "status", width: 110, render: (value: Subscription["status"]) => <StatusDot status={value === "正常" ? "success" : value === "更新失败" ? "error" : "default"}>{value}</StatusDot> },
    {
      title: "操作", key: "actions", width: 150, fixed: "right",
      render: (_, record) => <Space onClick={(event) => event.stopPropagation()}>
        <Button type="text" icon={<ReloadOutlined />} onClick={() => { refreshSubscriptions([record.id]); message.success("订阅更新完成"); }} aria-label="立即更新" />
        <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} aria-label="编辑订阅" />
        <Dropdown menu={{ items: [{ key: "copy", icon: <CopyOutlined />, label: "复制订阅" }, { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true }], onClick: ({ key }) => key === "delete" ? confirmDelete(record) : navigator.clipboard.writeText(record.url).then(() => message.success("订阅链接已复制")) }}>
          <Button type="text" icon={<MoreOutlined />} aria-label="更多操作" />
        </Dropdown>
      </Space>,
    },
  ];

  return (
    <div className="page-stack subscriptions-page">
      <PageHeader title="订阅" description="管理订阅源、更新配置并同步节点。" actions={<><Button icon={<ReloadOutlined />} onClick={() => { refreshSubscriptions(selectedIds.length ? selectedIds : undefined); message.success(selectedIds.length ? `已更新 ${selectedIds.length} 项订阅` : "批量更新完成"); }}>批量更新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增订阅</Button></>} />

      <Panel className="quick-import-panel">
        <div className="quick-import-icon"><LinkOutlined /></div>
        <div className="quick-import-content">
          <Flex align="center" gap={10}><Title level={3}>快速导入订阅链接</Title><Tag color="green">推荐</Tag></Flex>
          <Flex gap={12}><Input size="large" placeholder="粘贴订阅链接，例如：https://sub.example.com/xxxx" value={quickUrl} onChange={(event) => setQuickUrl(event.target.value)} onPressEnter={importQuickLink} /><Button type="primary" size="large" onClick={importQuickLink}>导入链接</Button></Flex>
          <Text type="secondary">粘贴订阅链接，系统将自动解析并创建订阅，快速开始使用。</Text>
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
              <Form.Item label="请求头（可选）" name="headers"><Input placeholder="例如：Authorization: Bearer token" /></Form.Item>
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
          <Button icon={<ReloadOutlined />} onClick={() => message.success("订阅测试成功，预计可导入 128 个节点")}>测试订阅</Button>
        </Form>
      </Modal>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={460} title="订阅详情">
        {detail && <div className="subscription-detail">
          <Flex justify="space-between" align="center"><Title level={3}>{detail.name}</Title><StatusDot status={detail.status === "正常" ? "success" : "error"}>{detail.status}</StatusDot></Flex>
          <Descriptions column={1} labelStyle={{ width: 100 }} items={[{ key: "url", label: "订阅地址", children: detail.url }, { key: "nodes", label: "节点数量", children: `${detail.nodeCount} 个` }, { key: "updated", label: "最后更新", children: detail.lastUpdated }, { key: "interval", label: "更新时间", children: detail.updateInterval ? `${detail.updateInterval} 小时` : "手动" }, { key: "traffic", label: "使用流量", children: detail.usedTraffic }, { key: "expires", label: "到期时间", children: detail.expiresAt }, { key: "format", label: "配置格式", children: "Clash Meta (YAML)" }]} />
          <Panel title="使用状态" className="detail-switches"><Flex vertical gap={16}><Flex justify="space-between">启用订阅<Switch checked={detail.enabled} onChange={(enabled) => { const next = { ...detail, enabled, status: enabled ? "正常" as const : "已禁用" as const }; updateSubscription(next); setDetail(next); }} /></Flex><Flex justify="space-between">自动更新<Switch checked={detail.autoUpdate} onChange={(autoUpdate) => { const next = { ...detail, autoUpdate }; updateSubscription(next); setDetail(next); }} /></Flex><Flex justify="space-between">代理更新<Switch checked={detail.proxyUpdate} onChange={(proxyUpdate) => { const next = { ...detail, proxyUpdate }; updateSubscription(next); setDetail(next); }} /></Flex></Flex></Panel>
          <Flex gap={12}><Button block icon={<EditOutlined />} onClick={() => { openEdit(detail); setDetail(null); }}>编辑订阅</Button><Button block type="primary" icon={<ReloadOutlined />} onClick={() => { refreshSubscriptions([detail.id]); message.success("订阅已更新"); }}>立即更新</Button></Flex>
        </div>}
      </Drawer>
    </div>
  );
}
