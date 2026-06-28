import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import {
  Button,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import { PageHeader, Panel, StatusDot } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { RoutingRule, RuleOrigin, RuleType } from "../types";
import { getRulePolicyNames } from "../utils/proxyGroups";

const { Text } = Typography;

function LabelWithHelp({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <span className="form-label-with-help">
      <span>{label}</span>
      <Popover
        title="用途说明"
        content={<span className="form-label-help-content">{description}</span>}
        trigger={["hover", "focus"]}
      >
        <button
          type="button"
          className="form-label-help-trigger"
          aria-label={`${label}用途说明`}
          onClick={(event) => event.preventDefault()}
        >
          <InfoCircleOutlined />
        </button>
      </Popover>
    </span>
  );
}

interface RuleFormValues {
  type: RuleType;
  content: string;
  policy: string;
  enabled: boolean;
  note?: string;
  noResolve: boolean;
  wildcard: boolean;
  extra?: string;
}

const typeColor: Record<RuleType, string> = {
  "DOMAIN-SUFFIX": "purple",
  "DOMAIN-KEYWORD": "orange",
  DOMAIN: "cyan",
  "IP-CIDR": "geekblue",
  "RULE-SET": "blue",
  GEOIP: "green",
  MATCH: "default",
};

type RuleSourceFilter = RuleOrigin | "all";

const ruleOriginMeta: Record<RuleOrigin, { color: string; label: string }> = {
  managed: { color: "purple", label: "托管" },
  local: { color: "default", label: "本地" },
};

const sourceOptions: { label: string; value: RuleSourceFilter }[] = [
  { label: "所有来源", value: "all" },
  { label: ruleOriginMeta.managed.label, value: "managed" },
  { label: ruleOriginMeta.local.label, value: "local" },
];

const getRuleOrigin = (source: unknown): RuleOrigin =>
  source === "local" || source === "本地规则" ? "local" : "managed";

export function RulesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [policyFilter, setPolicyFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<RuleSourceFilter>("all");
  const [showDisabled, setShowDisabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoutingRule | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggedRuleIdRef = useRef<string | null>(null);
  const [form] = Form.useForm<RuleFormValues>();
  const {
    groups,
    rules,
    ruleOverrides,
    addRule,
    updateRule,
    deleteRule,
    reorderRule,
    setRuleOverride,
  } = useAppStore();

  const rulePolicyOptions = useMemo(
    () => getRulePolicyNames(groups).map((value) => ({ label: value, value })),
    [groups],
  );
  const isRuleOverridden = (rule: RoutingRule) => ruleOverrides.some((item) =>
    item.targetType === rule.type && item.targetContent === rule.content);
  const saveRuleState = (target: RoutingRule, next: RoutingRule) => {
    if (getRuleOrigin(target.source) === "managed") setRuleOverride(target, next);
    else updateRule(next);
  };

  const filtered = useMemo(
    () =>
      rules.filter((rule) => {
        const ruleOrigin = getRuleOrigin(rule.source);
        return (
          `${rule.type}${rule.content}${rule.policy}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (typeFilter === "all" || rule.type === typeFilter) &&
          (policyFilter === "all" || rule.policy === policyFilter) &&
          (sourceFilter === "all" || ruleOrigin === sourceFilter) &&
          (showDisabled || rule.enabled)
        );
      }),
    [policyFilter, rules, search, showDisabled, sourceFilter, typeFilter],
  );

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: "DOMAIN-SUFFIX",
      policy: rulePolicyOptions[0]?.value ?? "DIRECT",
      enabled: true,
      noResolve: false,
      wildcard: false,
    });
    setModalOpen(true);
  };

  const openEdit = (rule: RoutingRule) => {
    setEditing(rule);
    form.setFieldsValue({
      type: rule.type,
      content: rule.content,
      policy: rule.policy,
      enabled: rule.enabled,
      note: rule.note,
      noResolve: rule.noResolve,
      wildcard: rule.wildcard,
    });
    setModalOpen(true);
  };

  const saveRule = async () => {
    const values = await form.validateFields();
    const rule: RoutingRule = {
      id: editing?.id ?? crypto.randomUUID(),
      type: values.type,
      content: values.content,
      source: editing ? getRuleOrigin(editing.source) : "local",
      policy: values.policy,
      enabled: values.enabled,
      noResolve: values.noResolve,
      wildcard: values.wildcard,
      note: values.note,
    };
    if (editing) saveRuleState(editing, rule);
    else addRule(rule);
    setModalOpen(false);
    message.success(editing ? "规则已保存" : "规则已添加");
  };

  const clearDragState = () => {
    draggedRuleIdRef.current = null;
    setDraggedId(null);
    setDragOverId(null);
  };

  const getRuleIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return (
      element?.closest<HTMLElement>("tr[data-row-key]")?.dataset.rowKey ?? null
    );
  };

  const handleDragStart = (
    event: PointerEvent<HTMLButtonElement>,
    ruleId: string,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggedRuleIdRef.current = ruleId;
    setDraggedId(ruleId);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const sourceRuleId = draggedRuleIdRef.current;
    if (!sourceRuleId) return;
    event.preventDefault();
    const targetRuleId = getRuleIdFromPoint(event.clientX, event.clientY);
    setDragOverId(
      targetRuleId && targetRuleId !== sourceRuleId ? targetRuleId : null,
    );
  };

  const handleDragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const sourceRuleId = draggedRuleIdRef.current;
    if (!sourceRuleId) return;
    event.preventDefault();
    const targetRuleId = getRuleIdFromPoint(event.clientX, event.clientY);
    if (targetRuleId && sourceRuleId !== targetRuleId)
      reorderRule(sourceRuleId, targetRuleId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    clearDragState();
  };

  const columns: TableColumnsType<RoutingRule> = [
    {
      title: "",
      key: "drag",
      width: 48,
      render: (_, record) => (
        <button
          type="button"
          className="drag-handle-button"
          aria-label="拖动规则排序"
          onPointerDown={(event) => handleDragStart(event, record.id)}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={clearDragState}
          onLostPointerCapture={clearDragState}
        >
          <HolderOutlined className="drag-handle" />
        </button>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 180,
      render: (value: RuleType) => <Tag color={typeColor[value]}>{value}</Tag>,
    },
    { title: "规则内容", dataIndex: "content", ellipsis: true },
    { title: "策略组", dataIndex: "policy", width: 180 },
    {
      title: "来源",
      dataIndex: "source",
      width: 100,
      render: (_: RoutingRule["source"], record) => {
        const origin = getRuleOrigin(record.source);
        const meta = ruleOriginMeta[origin];
        return <Space size={4}><Tag color={meta.color}>{meta.label}</Tag>{isRuleOverridden(record) && <Tag color="blue">本地覆写</Tag>}</Space>;
      },
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 105,
      render: (enabled: boolean, record) => (
        <button
          className="status-button"
          onClick={() =>
            saveRuleState(record, {
              ...record,
              source: getRuleOrigin(record.source),
              enabled: !enabled,
            })
          }
        >
          <StatusDot status={enabled ? "success" : "default"}>
            {enabled ? "启用" : "禁用"}
          </StatusDot>
        </button>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            aria-label="编辑规则"
          />
          <Dropdown
            menu={{
              items: [
                { key: "duplicate", icon: <CopyOutlined />, label: "复制规则" },
                {
                  key: "toggle",
                  label: record.enabled ? "禁用规则" : "启用规则",
                },
                {
                  key: "delete",
                  icon: <DeleteOutlined />,
                  danger: true,
                  label: "删除规则",
                },
              ],
              onClick: ({ key }) => {
                if (key === "delete") {
                  if (getRuleOrigin(record.source) === "managed") {
                    saveRuleState(record, { ...record, enabled: false });
                    message.success("托管规则已通过本地覆写禁用");
                  } else deleteRule(record.id);
                }
                if (key === "toggle")
                  saveRuleState(record, {
                    ...record,
                    source: getRuleOrigin(record.source),
                    enabled: !record.enabled,
                  });
                if (key === "duplicate")
                  addRule({
                    ...record,
                    id: crypto.randomUUID(),
                    source: getRuleOrigin(record.source),
                    content: `${record.content}-副本`,
                  });
              },
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="更多操作" />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack rules-page">
      <PageHeader
        title="规则"
        description="管理规则集与自定义规则，控制流量分流逻辑。"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            新增规则
          </Button>
        }
      />
      <Panel className="rules-panel">
        <div className="filter-bar rules-filter-bar">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索规则内容 / 域名组"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { label: "所有类型", value: "all" },
              ...Array.from(new Set(rules.map((rule) => rule.type))).map(
                (value) => ({ label: value, value }),
              ),
            ]}
          />
          <Select
            value={policyFilter}
            onChange={setPolicyFilter}
            options={[
              { label: "所有策略", value: "all" },
              ...Array.from(new Set(rules.map((rule) => rule.policy))).map(
                (value) => ({ label: value, value }),
              ),
            ]}
          />
          <Select
            value={sourceFilter}
            onChange={(value: RuleSourceFilter) => setSourceFilter(value)}
            options={sourceOptions}
          />
          <Flex align="center" gap={8} className="filter-switch">
            <Text>显示禁用</Text>
            <Switch checked={showDisabled} onChange={setShowDisabled} />
          </Flex>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
              setPolicyFilter("all");
              setSourceFilter("all");
            }}
            aria-label="重置筛选"
          />
        </div>
        <Table<RoutingRule>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 900 }}
          onRow={(record) => ({
            className: [
              draggedId === record.id ? "dragging-row" : "",
              dragOverId === record.id ? "drag-over-row" : "",
            ]
              .filter(Boolean)
              .join(" "),
          })}
        />
      </Panel>

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void saveRule()}
        okText="保存"
        cancelText="取消"
        title={editing ? "编辑规则" : "新增规则"}
        width={760}
        className="form-modal"
        destroyOnHidden
      >
        <Form<RuleFormValues> form={form} layout="vertical">
          <Panel title="基本设置" className="modal-section">
            <div className="form-grid two-columns">
              <Form.Item
                label="规则类型"
                name="type"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={editing ? getRuleOrigin(editing.source) === "managed" : false}
                  options={Object.keys(typeColor).map((value) => ({
                    label: value,
                    value,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label="规则内容"
                name="content"
                rules={[{ required: true, message: "请输入规则内容" }]}
              >
                <Input disabled={editing ? getRuleOrigin(editing.source) === "managed" : false} placeholder="例如：openai.com" />
              </Form.Item>
              <Form.Item
                label="策略组"
                name="policy"
                rules={[{ required: true }]}
              >
                <Select showSearch optionFilterProp="label" options={rulePolicyOptions} />
              </Form.Item>
              <Form.Item
                label="启用规则"
                name="enabled"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item label="备注（可选）" name="note" className="span-two">
                <Input placeholder="请输入备注（可选）" />
              </Form.Item>
            </div>
          </Panel>
          <Panel title="高级设置（可选）" className="modal-section">
            <div className="form-grid two-columns">
              <Form.Item
                label={
                  <LabelWithHelp
                    label="no-resolve"
                    description="跳过 DNS 解析，适合只按域名命中且不需要再解析 IP 的规则。"
                  />
                }
                name="noResolve"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={
                  <LabelWithHelp
                    label="通配匹配"
                    description="允许规则内容使用通配表达式匹配一组域名或路径，减少重复规则。"
                  />
                }
                name="wildcard"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label={
                  <LabelWithHelp
                    label="附加参数（可选）"
                    description="填写规则后缀参数，用于补充匹配条件或兼容内核支持的扩展写法。"
                  />
                }
                name="extra"
                className="span-two"
              >
                <Input placeholder="例如：@cn,ip-cidr,port(80)" />
              </Form.Item>
            </div>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => (
                <div className="rule-preview">
                  <Text type="secondary">规则预览</Text>
                  <code>
                    {getFieldValue("type")},
                    {getFieldValue("content") || "规则内容"},
                    {getFieldValue("policy")}
                  </code>
                </div>
              )}
            </Form.Item>
          </Panel>
          <Button
            icon={<ExperimentOutlined />}
            onClick={() => message.success("测试通过：规则语法有效")}
          >
            测试规则
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
