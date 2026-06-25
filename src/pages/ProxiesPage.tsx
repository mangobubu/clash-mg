import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Radio,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { IconPicker, defaultProxyGroupIcon } from "../components/IconPicker";
import { Latency, PageHeader, Panel } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { ProxyGroup, ProxyGroupOrigin, ProxyGroupType, ProxyNode } from "../types";

const { Text } = Typography;

interface GroupFormValues {
  type: ProxyGroupType;
  name: string;
  icon: string;
  description?: string;
  testUrl: string;
  interval: number;
  tolerance: number;
  loadBalance: string;
  autoTest: boolean;
  nodeIds: string[];
  healthCheck: boolean;
  failureThreshold: number;
  extra?: string;
}

const groupTypeColorMap: Record<ProxyGroupType, string> = {
  Selector: "blue",
  Fallback: "gold",
  "URL-Test": "green",
  "Load-Balance": "cyan",
  Direct: "default",
  Block: "red",
};

const groupOriginMeta: Record<ProxyGroupOrigin, { color: string; label: string }> = {
  managed: { color: "purple", label: "托管" },
  local: { color: "default", label: "本地" },
};

const legacyManagedGroupIds = new Set(["auto", "fallback", "manual"]);
const getProxyGroupOrigin = (group: ProxyGroup): ProxyGroupOrigin => group.origin ?? (legacyManagedGroupIds.has(group.id) ? "managed" : "local");
const isEditableLocalGroup = (group: ProxyGroup) => getProxyGroupOrigin(group) === "local" && group.type !== "Direct" && group.type !== "Block";
const getGroupEditBlockedMessage = (group: ProxyGroup) => getProxyGroupOrigin(group) === "managed" ? "托管代理组不能编辑" : "该本地代理组暂不支持编辑";

const groupTypeOptions: Array<{ label: string; value: ProxyGroupType }> = [
  { label: "手动选择", value: "Selector" },
  { label: "故障转移", value: "Fallback" },
  { label: "自动测速", value: "URL-Test" },
  { label: "负载均衡", value: "Load-Balance" },
];

const loadBalanceOptions = [
  { label: "轮询", value: "round-robin" },
  { label: "一致性哈希", value: "consistent-hashing" },
  { label: "粘性会话", value: "sticky-sessions" },
];

const loadBalanceStrategyHelp = (
  <div style={{ maxWidth: 320 }}>
    <p style={{ margin: "0 0 6px" }}><strong>轮询：</strong>将请求依次分配到不同节点，适合平均摊分流量。</p>
    <p style={{ margin: "0 0 6px" }}><strong>一致性哈希：</strong>相同目标地址固定走同一节点，适合减少目标侧会话漂移。</p>
    <p style={{ margin: 0 }}><strong>粘性会话：</strong>相同来源和目标地址固定走同一节点，适合登录态或长会话场景。</p>
  </div>
);

const loadBalanceStrategyLabel = (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span>负载均衡策略</span>
    <Popover content={loadBalanceStrategyHelp} title="策略说明" trigger={["hover", "focus"]}>
      <InfoCircleOutlined aria-label="查看负载均衡策略说明" role="button" tabIndex={0} style={{ color: "#8c8c8c", cursor: "help" }} />
    </Popover>
  </span>
);

const autoTestHelp = "开启后会按测试间隔定期对组内节点发起延迟测试，用于刷新延迟数据；当代理组类型为“自动测速”时，可据此选择更低延迟节点。";

const autoTestLabel = (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span>定时测速</span>
    <Popover content={autoTestHelp} title="定时测速说明" trigger={["hover", "focus"]}>
      <InfoCircleOutlined aria-label="查看定时测速说明" role="button" tabIndex={0} style={{ color: "#8c8c8c", cursor: "help" }} />
    </Popover>
  </span>
);

const toleranceHelp = "仅在“自动测速”类型下用于判断是否切换节点；延迟差小于容差时保持当前节点，避免频繁切换。";

const toleranceLabel = (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span>容差（ms）</span>
    <Popover content={toleranceHelp} title="容差说明" trigger={["hover", "focus"]}>
      <InfoCircleOutlined aria-label="查看容差说明" role="button" tabIndex={0} style={{ color: "#8c8c8c", cursor: "help" }} />
    </Popover>
  </span>
);

const advancedHelpIconStyle = { color: "#8c8c8c", cursor: "help" } as const;

const createAdvancedHelpLabel = (label: string, help: string) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span>{label}</span>
    <Popover content={<div style={{ maxWidth: 300 }}>{help}</div>} title={`${label}说明`} trigger={["hover", "focus"]}>
      <QuestionCircleOutlined aria-label={`查看${label}说明`} role="button" tabIndex={0} style={advancedHelpIconStyle} />
    </Popover>
  </span>
);

const healthCheckLabel = createAdvancedHelpLabel("健康检查", "关注节点是否可连通，不以延迟高低为核心；主要用于判断节点故障，并为故障转移或自动选择提供可用性依据。");
const failureThresholdLabel = createAdvancedHelpLabel("失败切换阈值", "节点连续不可用达到该次数后才判定故障并触发切换，避免一次探测失败或短暂网络抖动造成误切换。");
const extraParamsLabel = createAdvancedHelpLabel("附加参数", "填写需要追加到代理组配置的高级参数，适合 Clash / Mihomo 兼容字段或临时实验项。");

interface CurrentNodeInfo {
  name: string;
  latency?: number;
}

export function ProxiesPage() {
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null);
  const [nodePickerGroupId, setNodePickerGroupId] = useState<string | null>(null);
  const [testingNodeIds, setTestingNodeIds] = useState<string[]>([]);
  const [simulatedLatencies, setSimulatedLatencies] = useState<Record<string, number>>({});
  const testTimerRefs = useRef<number[]>([]);
  const [groupForm] = Form.useForm<GroupFormValues>();
  const { nodes, groups, selectNode, addGroup, updateGroup } = useAppStore();
  const activeNodeGroup = groups.find((group) => group.id === nodePickerGroupId);
  const isAutoTestGroup = activeNodeGroup?.type === "URL-Test";
  const groupSelectableNodes = nodes.slice(0, 8);
  const defaultGroupFormValues: GroupFormValues = {
    type: "Selector",
    name: "",
    icon: defaultProxyGroupIcon,
    description: "",
    testUrl: "https://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 50,
    loadBalance: "round-robin",
    autoTest: true,
    nodeIds: groupSelectableNodes.slice(0, 4).map((node) => node.id),
    healthCheck: true,
    failureThreshold: 3,
    extra: "",
  };

  const handleGroupKeyDown = (event: KeyboardEvent<HTMLElement>, groupId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setNodePickerGroupId(groupId);
    }
  };

  const getCurrentNodeInfo = (group: ProxyGroup): CurrentNodeInfo => {
    const current = nodes.find((node) => node.id === group.currentNodeId);
    if (current) return { name: current.name, latency: simulatedLatencies[current.id] ?? current.latency };
    if (group.type === "Direct") return { name: "直连" };
    if (group.type === "Block") return { name: "REJECT" };
    return { name: "未选择" };
  };

  const getDisplayedLatency = (node: ProxyNode) => simulatedLatencies[node.id] ?? node.latency;
  const getSortLatency = (node: ProxyNode) => node.available ? getDisplayedLatency(node) : Number.POSITIVE_INFINITY;

  const pickerNodes = activeNodeGroup
    ? activeNodeGroup.nodeIds
      .map((nodeId) => nodes.find((node) => node.id === nodeId))
      .filter((node): node is ProxyNode => Boolean(node))
    : [];
  const sortedPickerNodes = [...pickerNodes].sort((a, b) => getSortLatency(a) - getSortLatency(b));

  const clearTestTimers = () => {
    testTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    testTimerRefs.current = [];
  };

  useEffect(() => clearTestTimers, []);

  const closeNodePicker = () => {
    clearTestTimers();
    setTestingNodeIds([]);
    setNodePickerGroupId(null);
  };

  const testNodes = () => {
    clearTestTimers();
    const testableNodes = pickerNodes.filter((node) => node.available);
    const nodeIds = testableNodes.map((node) => node.id);
    const testedResults: Array<{ node: ProxyNode; latency: number }> = [];

    if (!testableNodes.length) {
      message.info("当前代理组没有可测试节点");
      return;
    }

    if (!nodeIds.length) return;
    setTestingNodeIds(nodeIds);

    testableNodes.forEach((node) => {
      const timer = window.setTimeout(() => {
        const jitter = 0.72 + Math.random() * 0.58;
        const latency = Math.max(18, Math.round(node.latency * jitter + Math.random() * 18));
        testedResults.push({ node, latency });
        setSimulatedLatencies((latencies) => ({ ...latencies, [node.id]: latency }));
        setTestingNodeIds((ids) => ids.filter((id) => id !== node.id));

        if (testedResults.length === testableNodes.length) {
          testTimerRefs.current = [];
          if (activeNodeGroup?.type === "URL-Test") {
            const bestNode = testedResults.reduce((best, item) => item.latency < best.latency ? item : best);
            selectNode(bestNode.node.id, activeNodeGroup.id);
            message.success(`已自动选择最低延迟节点 ${bestNode.node.name}`);
          } else {
            message.success("测速完成");
          }
        }
      }, 450 + Math.random() * 1150);
      testTimerRefs.current.push(timer);
    });
  };

  const selectPickerNode = (node: ProxyNode) => {
    if (!activeNodeGroup || activeNodeGroup.type === "URL-Test" || !node.available || testingNodeIds.includes(node.id)) return;
    selectNode(node.id, activeNodeGroup.id);
    message.success(`已切换至 ${node.name}`);
    closeNodePicker();
  };

  const selectAllGroupNodes = () => {
    groupForm.setFieldValue("nodeIds", groupSelectableNodes.map((node) => node.id));
  };

  const invertGroupNodeSelection = () => {
    const selectedIds = groupForm.getFieldValue("nodeIds") ?? [];
    const selectedIdSet = new Set(selectedIds);
    groupForm.setFieldValue("nodeIds", groupSelectableNodes.filter((node) => !selectedIdSet.has(node.id)).map((node) => node.id));
  };

  const openCreateGroupModal = () => {
    setEditingGroup(null);
    groupForm.setFieldsValue(defaultGroupFormValues);
    setGroupModalOpen(true);
  };

  const openEditGroupModal = (event: MouseEvent<HTMLElement>, group: ProxyGroup) => {
    event.stopPropagation();

    if (!isEditableLocalGroup(group)) {
      message.warning(getGroupEditBlockedMessage(group));
      return;
    }

    setEditingGroup(group);
    groupForm.setFieldsValue({
      ...defaultGroupFormValues,
      type: group.type,
      name: group.name,
      icon: group.icon || defaultProxyGroupIcon,
      description: group.description,
      autoTest: group.autoTest,
      nodeIds: group.nodeIds,
    });
    setGroupModalOpen(true);
  };

  const closeGroupModal = () => {
    setGroupModalOpen(false);
    setEditingGroup(null);
    groupForm.resetFields();
  };

  const saveGroup = async () => {
    const values = await groupForm.validateFields();
    const currentNodeId = values.nodeIds.includes(editingGroup?.currentNodeId ?? "")
      ? editingGroup?.currentNodeId
      : values.nodeIds[0];
    const group: ProxyGroup = {
      id: editingGroup?.id ?? crypto.randomUUID(),
      name: values.name,
      type: values.type,
      origin: "local",
      icon: values.icon,
      description: values.description ?? "自定义代理组",
      nodeIds: values.nodeIds,
      currentNodeId,
      autoTest: values.autoTest,
      allowManual: values.type !== "URL-Test",
    };

    if (editingGroup) {
      if (!isEditableLocalGroup(editingGroup)) {
        message.warning(getGroupEditBlockedMessage(editingGroup));
        return;
      }
      updateGroup(group);
      message.success("代理组已更新");
    } else {
      addGroup(group);
      message.success("代理组已创建");
    }

    closeGroupModal();
  };

  return (
    <div className="page-stack proxies-page">
      <PageHeader
        title="代理"
        description="集中查看和管理代理组策略。"
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreateGroupModal}>新增代理组</Button>}
      />
      <div className="proxy-group-card-grid">
        {groups.length ? groups.map((group) => {
          const currentNode = getCurrentNodeInfo(group);
          const originMeta = groupOriginMeta[getProxyGroupOrigin(group)];
          const canEditGroup = isEditableLocalGroup(group);
          return (
            <article
              key={group.id}
              className="proxy-group-card"
              role="button"
              tabIndex={0}
              onClick={() => setNodePickerGroupId(group.id)}
              onKeyDown={(event) => handleGroupKeyDown(event, group.id)}
            >
              <div className="proxy-group-card-head">
                <strong>{group.name}</strong>
                <span className="proxy-group-card-tags">
                  <Tag color={originMeta.color}>{originMeta.label}</Tag>
                  <Tag color={groupTypeColorMap[group.type]}>{group.type}</Tag>
                </span>
              </div>
              <dl className="proxy-group-card-details">
                <div>
                  <dt>当前节点</dt>
                  <dd>{currentNode.name}</dd>
                </div>
                <div>
                  <dt>延迟</dt>
                  <dd>{currentNode.latency === undefined ? <Text type="secondary">—</Text> : <Latency value={currentNode.latency} />}</dd>
                </div>
              </dl>
              {canEditGroup && (
                <div className="proxy-group-card-actions">
                  <Button size="small" icon={<EditOutlined />} onClick={(event) => openEditGroupModal(event, group)} onKeyDown={(event) => event.stopPropagation()}>编辑</Button>
                </div>
              )}
            </article>
          );
        }) : <Empty className="proxy-group-empty" description="暂无代理组" />}
      </div>

      <Modal
        open={Boolean(activeNodeGroup)}
        onCancel={closeNodePicker}
        footer={null}
        title={activeNodeGroup ? `选择节点 - ${activeNodeGroup.name}` : "选择节点"}
        width={860}
        className="node-picker-modal"
        destroyOnHidden
      >
        <div className="proxy-node-picker-toolbar">
          <Text type="secondary">共 {pickerNodes.length} 个节点</Text>
          <Button type="primary" onClick={testNodes} loading={testingNodeIds.length > 0} disabled={!pickerNodes.length}>测试</Button>
        </div>
        {sortedPickerNodes.length ? (
          <div className="proxy-node-picker-list">
            {sortedPickerNodes.map((node) => {
              const isTesting = testingNodeIds.includes(node.id);
              const isSelected = node.id === activeNodeGroup?.currentNodeId;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`${isSelected ? "selected" : ""}${isAutoTestGroup ? " auto-managed" : ""}`}
                  aria-disabled={isAutoTestGroup || !node.available || isTesting}
                  disabled={!node.available || isTesting}
                  onClick={() => selectPickerNode(node)}
                >
                  <span className="proxy-node-picker-card-head">
                    <Radio checked={isSelected} disabled={isAutoTestGroup} />
                    <span className="flag">{node.flag}</span>
                  </span>
                  <span className="proxy-node-picker-name"><strong>{node.name}</strong><small>{node.country} · {node.protocol}</small></span>
                  <span className="proxy-node-picker-latency">
                    {!node.available ? <Tag color="default">不可用</Tag> : isTesting ? <><Spin size="small" />测速中</> : <Latency value={getDisplayedLatency(node)} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : <Empty className="proxy-node-picker-empty" description="当前代理组没有可选择节点" />}
      </Modal>

      <Modal open={groupModalOpen} onCancel={closeGroupModal} onOk={() => void saveGroup()} okText="保存" cancelText="取消" title={editingGroup ? "编辑代理组" : "新增代理组"} width={1040} className="form-modal" destroyOnHidden>
        <Form<GroupFormValues> form={groupForm} layout="vertical" initialValues={defaultGroupFormValues}>
          <Panel title="基本设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="类型" name="type"><Select options={groupTypeOptions} /></Form.Item><Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入代理组名称" }]}><Input placeholder="请输入代理组名称" /></Form.Item><Form.Item label="图标" name="icon"><IconPicker /></Form.Item><Form.Item label="说明 / 备注" name="description"><Input placeholder="选填" /></Form.Item></div></Panel>
          <Panel title="策略设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="测试 URL" name="testUrl"><Input /></Form.Item><Form.Item label="测试间隔（秒）" name="interval"><InputNumber min={30} style={{ width: "100%" }} /></Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>{({ getFieldValue }) => getFieldValue("type") === "URL-Test" ? <Form.Item label={toleranceLabel} name="tolerance"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item> : null}</Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>{({ getFieldValue }) => getFieldValue("type") === "Load-Balance" ? <Form.Item label={loadBalanceStrategyLabel} name="loadBalance"><Select options={loadBalanceOptions} /></Form.Item> : null}</Form.Item><Form.Item label={autoTestLabel} name="autoTest" valuePropName="checked"><Switch /></Form.Item></div></Panel>
          <Panel title="节点选择" extra={<Flex align="center" gap={8}><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Tag color="blue">已选 {(getFieldValue("nodeIds") as string[] | undefined)?.length ?? 0} 个节点</Tag>}</Form.Item><Button size="small" onClick={selectAllGroupNodes} disabled={!groupSelectableNodes.length}>全选</Button><Button size="small" onClick={invertGroupNodeSelection} disabled={!groupSelectableNodes.length}>反选</Button></Flex>} className="modal-section">
            <Form.Item name="nodeIds" rules={[{ required: true, message: "请至少选择一个节点" }]}><Checkbox.Group className="group-node-checkboxes">{groupSelectableNodes.map((node) => <Checkbox key={node.id} value={node.id}><span className="flag">{node.flag}</span><strong>{node.name}</strong><Tag color="blue">{node.protocol}</Tag><Latency value={node.latency} showBars={false} /></Checkbox>)}</Checkbox.Group></Form.Item>
          </Panel>
          <Panel title="高级设置（可选）" className="modal-section"><div className="form-grid four-columns"><Form.Item label={healthCheckLabel} name="healthCheck" valuePropName="checked"><Switch /></Form.Item><Form.Item label={failureThresholdLabel} name="failureThreshold"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item><Form.Item label={extraParamsLabel} name="extra" className="span-two"><Input placeholder="例如：disable-udp=true, include-all-proxies=true" /></Form.Item></div></Panel>
        </Form>
      </Modal>
    </div>
  );
}
