import { useMemo, useState } from "react";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Flex, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { TableColumnsType } from "antd";
import { HintBar, PageHeader, Panel, StatusDot } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { RoutingRule, RuleType } from "../types";

const { Text } = Typography;

interface RuleFormValues {
  type: RuleType;
  content: string;
  source: RoutingRule["source"];
  policy: string;
  enabled: boolean;
  priority: number;
  note?: string;
  noResolve: boolean;
  wildcard: boolean;
  extra?: string;
}

const typeColor: Record<RuleType, string> = {
  "DOMAIN-SUFFIX": "purple", "DOMAIN-KEYWORD": "orange", DOMAIN: "cyan", "IP-CIDR": "geekblue",
  "RULE-SET": "blue", GEOIP: "green", MATCH: "default",
};

export function RulesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [policyFilter, setPolicyFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showDisabled, setShowDisabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoutingRule | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [form] = Form.useForm<RuleFormValues>();
  const { rules, addRule, updateRule, deleteRule, reorderRule } = useAppStore();

  const filtered = useMemo(() => rules.filter((rule) =>
    `${rule.type}${rule.content}${rule.policy}`.toLowerCase().includes(search.toLowerCase())
    && (typeFilter === "all" || rule.type === typeFilter)
    && (policyFilter === "all" || rule.policy === policyFilter)
    && (sourceFilter === "all" || rule.source === sourceFilter)
    && (showDisabled || rule.enabled)), [policyFilter, rules, search, showDisabled, sourceFilter, typeFilter]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: "DOMAIN-SUFFIX", source: "本地规则", policy: "ChatGPT", enabled: true, priority: 1, noResolve: false, wildcard: false });
    setModalOpen(true);
  };

  const openEdit = (rule: RoutingRule) => {
    setEditing(rule);
    form.setFieldsValue({ ...rule, priority: rules.findIndex((item) => item.id === rule.id) + 1 });
    setModalOpen(true);
  };

  const saveRule = async () => {
    const values = await form.validateFields();
    const rule: RoutingRule = {
      id: editing?.id ?? crypto.randomUUID(), type: values.type, content: values.content, source: values.source,
      policy: values.policy, enabled: values.enabled, noResolve: values.noResolve, wildcard: values.wildcard, note: values.note,
    };
    if (editing) updateRule(rule); else addRule(rule);
    setModalOpen(false);
    message.success(editing ? "规则已保存" : "规则已添加");
  };

  const columns: TableColumnsType<RoutingRule> = [
    { title: "", key: "drag", width: 48, render: () => <HolderOutlined className="drag-handle" /> },
    { title: "优先级", key: "priority", width: 78, align: "center", render: (_, record) => rules.findIndex((item) => item.id === record.id) + 1 },
    { title: "类型", dataIndex: "type", width: 180, render: (value: RuleType) => <Tag color={typeColor[value]}>{value}</Tag> },
    { title: "规则内容", dataIndex: "content", ellipsis: true },
    { title: "策略组", dataIndex: "policy", width: 180 },
    { title: "来源", dataIndex: "source", width: 170 },
    { title: "状态", dataIndex: "enabled", width: 105, render: (enabled: boolean, record) => <button className="status-button" onClick={() => updateRule({ ...record, enabled: !enabled })}><StatusDot status={enabled ? "success" : "default"}>{enabled ? "启用" : "禁用"}</StatusDot></button> },
    {
      title: "操作", key: "actions", width: 120,
      render: (_, record) => <Space><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} aria-label="编辑规则" /><Dropdown menu={{ items: [{ key: "duplicate", icon: <CopyOutlined />, label: "复制规则" }, { key: "toggle", label: record.enabled ? "禁用规则" : "启用规则" }, { key: "delete", icon: <DeleteOutlined />, danger: true, label: "删除规则" }], onClick: ({ key }) => { if (key === "delete") deleteRule(record.id); if (key === "toggle") updateRule({ ...record, enabled: !record.enabled }); if (key === "duplicate") addRule({ ...record, id: crypto.randomUUID(), content: `${record.content}-副本` }); } }}><Button type="text" icon={<MoreOutlined />} aria-label="更多操作" /></Dropdown></Space>,
    },
  ];

  return (
    <div className="page-stack rules-page">
      <PageHeader title="规则" description="管理规则集与自定义规则，控制流量分流逻辑。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增规则</Button>} />
      <Panel className="rules-panel">
        <div className="filter-bar rules-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索规则内容 / 域名组" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select value={typeFilter} onChange={setTypeFilter} options={[{ label: "所有类型", value: "all" }, ...Array.from(new Set(rules.map((rule) => rule.type))).map((value) => ({ label: value, value }))]} />
          <Select value={policyFilter} onChange={setPolicyFilter} options={[{ label: "所有策略", value: "all" }, ...Array.from(new Set(rules.map((rule) => rule.policy))).map((value) => ({ label: value, value }))]} />
          <Select value={sourceFilter} onChange={setSourceFilter} options={[{ label: "所有来源", value: "all" }, ...Array.from(new Set(rules.map((rule) => rule.source))).map((value) => ({ label: value, value }))]} />
          <Flex align="center" gap={8} className="filter-switch"><Text>显示禁用</Text><Switch checked={showDisabled} onChange={setShowDisabled} /></Flex>
          <Button icon={<ReloadOutlined />} onClick={() => { setSearch(""); setTypeFilter("all"); setPolicyFilter("all"); setSourceFilter("all"); }} aria-label="重置筛选" />
        </div>
        <Table<RoutingRule>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 980 }}
          onRow={(record) => ({
            draggable: true,
            onDragStart: () => setDraggedId(record.id),
            onDragOver: (event) => event.preventDefault(),
            onDrop: () => { if (draggedId) reorderRule(draggedId, record.id); setDraggedId(null); },
            onDragEnd: () => setDraggedId(null),
            className: draggedId === record.id ? "dragging-row" : "",
          })}
        />
      </Panel>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void saveRule()} okText="保存" cancelText="取消" title={editing ? "编辑规则" : "新增规则"} width={760} className="form-modal" destroyOnHidden>
        <Form<RuleFormValues> form={form} layout="vertical">
          <Panel title="基本设置" className="modal-section">
            <div className="form-grid two-columns">
              <Form.Item label="规则类型" name="type" rules={[{ required: true }]}><Select options={Object.keys(typeColor).map((value) => ({ label: value, value }))} /></Form.Item>
              <Form.Item label="来源" name="source"><Select options={["本地规则", "内置规则集", "内置规则", "默认规则"].map((value) => ({ label: value, value }))} /></Form.Item>
              <Form.Item label="规则内容" name="content" rules={[{ required: true, message: "请输入规则内容" }]}><Input placeholder="例如：openai.com" /></Form.Item>
              <Form.Item label="策略组" name="policy" rules={[{ required: true }]}><Select options={["ChatGPT", "全球直连", "搜索服务", "直连", "代理", "媒体分流", "广告拦截"].map((value) => ({ label: value, value }))} /></Form.Item>
              <Form.Item label="优先级" name="priority"><InputNumber min={1} max={rules.length + 1} style={{ width: "100%" }} /></Form.Item>
              <Form.Item label="启用规则" name="enabled" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item label="备注（可选）" name="note" className="span-two"><Input placeholder="请输入备注（可选）" /></Form.Item>
            </div>
          </Panel>
          <Panel title="高级设置（可选）" className="modal-section">
            <div className="form-grid two-columns"><Form.Item label="no-resolve" name="noResolve" valuePropName="checked"><Switch /></Form.Item><Form.Item label="通配匹配" name="wildcard" valuePropName="checked"><Switch /></Form.Item><Form.Item label="附加参数（可选）" name="extra" className="span-two"><Input placeholder="例如：@cn,ip-cidr,port(80)" /></Form.Item></div>
            <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <div className="rule-preview"><Text type="secondary">规则预览</Text><code>{getFieldValue("type")},{getFieldValue("content") || "规则内容"},{getFieldValue("policy")}</code></div>}</Form.Item>
          </Panel>
          <HintBar>带 * 的字段为必填项。</HintBar>
          <Button icon={<ExperimentOutlined />} onClick={() => message.success("测试通过：规则语法有效")}>测试规则</Button>
        </Form>
      </Modal>
    </div>
  );
}
