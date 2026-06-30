import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
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
import { compareProxyNodesByLatency } from "../utils/nodeLatency";
import { continentOptions, getNodeContinent, type ContinentFilter } from "../utils/nodeLocation";
import {
  getSelectableProxyGroupMembers,
  isDirectOrRejectProxyGroup,
  isGlobalProxyGroup,
  isHiddenBuiltinProxyGroup,
  resolveProxyGroupCurrentNode,
} from "../utils/proxyGroups";

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
  groupIds: string[];
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
const canConfigureGroup = (group: ProxyGroup) => getProxyGroupOrigin(group) === "managed" || isEditableLocalGroup(group);

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

interface CurrentProxyInfo {
  name: string;
  latency?: number;
}

export function ProxiesPage() {
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null);
  const [nodePickerGroupId, setNodePickerGroupId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerContinent, setPickerContinent] = useState<ContinentFilter>("all");
  const [testingNodeIds, setTestingNodeIds] = useState<string[]>([]);
  const [simulatedLatencies, setSimulatedLatencies] = useState<Record<string, number>>({});
  const testTimerRefs = useRef<number[]>([]);
  const [groupForm] = Form.useForm<GroupFormValues>();
  const {
    nodes,
    groups,
    proxyGroupOverrides,
    selectProxy,
    addGroup,
    updateGroup,
    setProxyGroupOverride,
    testNodeLatency,
    refreshRuntimeData,
  } = useAppStore();
  const activeNodeGroup = groups.find((group) => group.id === nodePickerGroupId);
  const isRuntimeManagedGroup = activeNodeGroup ? !activeNodeGroup.allowManual : false;
  const isEditingManagedGroup = editingGroup ? getProxyGroupOrigin(editingGroup) === "managed" : false;
  const groupSelectableNodes = nodes.slice(0, 8);
  const visibleGroups = groups.filter((group) => !isHiddenBuiltinProxyGroup(group));
  const groupSelectableGroups = getSelectableProxyGroupMembers(groups, editingGroup?.id)
    .filter((group) => !isEditingManagedGroup || getProxyGroupOrigin(group) === "local");
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
    groupIds: [],
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

  const getCurrentProxyInfo = (group: ProxyGroup): CurrentProxyInfo => {
    const current = nodes.find((node) => node.id === group.currentNodeId);
    if (current) return { name: current.name, latency: simulatedLatencies[current.id] ?? current.latency };
    const nestedGroup = groups.find((candidate) => candidate.id === group.currentNodeId);
    if (nestedGroup) {
      const currentNode = resolveProxyGroupCurrentNode(nestedGroup, groups, nodes);
      return {
        name: nestedGroup.name,
        latency: currentNode ? simulatedLatencies[currentNode.id] ?? currentNode.latency : undefined,
      };
    }
    if (group.type === "Direct") return { name: "直连" };
    if (group.type === "Block") return { name: "REJECT" };
    return { name: "未选择" };
  };

  const getDisplayedLatency = (node: ProxyNode) => simulatedLatencies[node.id] ?? node.latency;

  const pickerNodes = activeNodeGroup
    ? activeNodeGroup.nodeIds
      .map((nodeId) => nodes.find((node) => node.id === nodeId))
      .filter((node): node is ProxyNode => Boolean(node))
    : [];
  const pickerGroups = activeNodeGroup
    ? (activeNodeGroup.groupIds ?? [])
      .map((groupId) => groups.find((group) => group.id === groupId))
      .filter((group): group is ProxyGroup => group !== undefined)
      .filter((group) => group.id !== activeNodeGroup.id)
      .filter((group) => !isGlobalProxyGroup(group))
    : [];
  const normalizedPickerSearch = pickerSearch.trim().toLowerCase();
  const filteredPickerNodes = pickerNodes.filter((node) => {
    const matchesName = !normalizedPickerSearch || node.name.toLowerCase().includes(normalizedPickerSearch);
    const matchesContinent = pickerContinent === "all" || getNodeContinent(node) === pickerContinent;
    return matchesName && matchesContinent;
  });
  const filteredPickerGroups = pickerGroups.filter((group) =>
    !normalizedPickerSearch || group.name.toLowerCase().includes(normalizedPickerSearch));
  const sortedPickerNodes = [...filteredPickerNodes].sort((left, right) =>
    compareProxyNodesByLatency(left, right, getDisplayedLatency));

  const clearTestTimers = () => {
    testTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    testTimerRefs.current = [];
  };

  useEffect(() => clearTestTimers, []);
  useEffect(() => {
    void refreshRuntimeData();
    const timer = window.setInterval(() => void refreshRuntimeData(), 5_000);
    return () => window.clearInterval(timer);
  }, [refreshRuntimeData]);

  const closeNodePicker = () => {
    clearTestTimers();
    setTestingNodeIds([]);
    setNodePickerGroupId(null);
    setPickerSearch("");
    setPickerContinent("all");
  };

  const testNodes = () => {
    clearTestTimers();
    const testableNodes = pickerNodes;
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
        void testNodeLatency(node.id).then((result) => {
          const latency = result.available ? result.latency : Number.POSITIVE_INFINITY;
          testedResults.push({ node, latency });
          if (result.available) setSimulatedLatencies((latencies) => ({ ...latencies, [node.id]: result.latency }));
          setTestingNodeIds((ids) => ids.filter((id) => id !== node.id));

          if (testedResults.length === testableNodes.length) {
            testTimerRefs.current = [];
            if (activeNodeGroup?.type === "URL-Test") {
              void refreshRuntimeData().then(() => {
                message.success("测速完成，已同步 Mihomo 的自动选择结果");
              });
            } else {
              message.success("测速完成");
            }
          }
        });
      }, 320);
      testTimerRefs.current.push(timer);
    });
  };

  const selectPickerNode = (node: ProxyNode) => {
    if (!activeNodeGroup || !activeNodeGroup.allowManual || !node.available || testingNodeIds.includes(node.id)) return;
    void selectProxy(node.id, activeNodeGroup.id);
    message.success(`已切换至 ${node.name}`);
    closeNodePicker();
  };

  const selectPickerGroup = (group: ProxyGroup) => {
    if (!activeNodeGroup || !activeNodeGroup.allowManual) return;
    void selectProxy(group.id, activeNodeGroup.id);
    message.success(`已切换至代理组 ${group.name}`);
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

    if (!canConfigureGroup(group)) {
      message.warning("该代理组暂不支持编辑");
      return;
    }

    const managedOverride = proxyGroupOverrides.find((item) => item.targetGroupId === group.id);
    setEditingGroup(group);
    groupForm.setFieldsValue({
      ...defaultGroupFormValues,
      type: group.type,
      name: group.name,
      icon: group.icon || defaultProxyGroupIcon,
      description: group.description,
      autoTest: group.autoTest,
      nodeIds: getProxyGroupOrigin(group) === "managed" ? [] : group.nodeIds,
      groupIds: getProxyGroupOrigin(group) === "managed"
        ? managedOverride?.addedGroupIds ?? []
        : group.groupIds ?? [],
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
    if (editingGroup && getProxyGroupOrigin(editingGroup) === "managed") {
      setProxyGroupOverride(editingGroup, values.groupIds);
      message.success(values.groupIds.length ? "托管代理组本地覆写已保存" : "托管代理组本地覆写已清除");
      closeGroupModal();
      return;
    }

    const selectedProxyIds = [...values.nodeIds, ...values.groupIds];
    if (!selectedProxyIds.length) {
      message.warning("请至少选择一个节点、代理组或内置策略");
      return;
    }
    const currentNodeId = selectedProxyIds.includes(editingGroup?.currentNodeId ?? "")
      ? editingGroup?.currentNodeId
      : selectedProxyIds[0];
    const group: ProxyGroup = {
      id: editingGroup?.id ?? crypto.randomUUID(),
      name: values.name,
      type: values.type,
      origin: "local",
      icon: values.icon,
      description: values.description ?? "自定义代理组",
      nodeIds: values.nodeIds,
      groupIds: values.groupIds,
      currentNodeId,
      autoTest: values.autoTest,
      allowManual: values.type === "Selector" || values.type === "Fallback",
    };

    if (editingGroup) {
      if (!isEditableLocalGroup(editingGroup)) {
        message.warning("该本地代理组暂不支持编辑");
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
        {visibleGroups.length ? visibleGroups.map((group) => {
          const currentProxy = getCurrentProxyInfo(group);
          const originMeta = groupOriginMeta[getProxyGroupOrigin(group)];
          const canEditGroup = canConfigureGroup(group);
          const isManagedGroup = getProxyGroupOrigin(group) === "managed";
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
                  <dt>当前选择</dt>
                  <dd>{currentProxy.name}</dd>
                </div>
                <div>
                  <dt>延迟</dt>
                  <dd>{currentProxy.latency === undefined ? <Text type="secondary">—</Text> : <Latency value={currentProxy.latency} />}</dd>
                </div>
              </dl>
              {canEditGroup && (
                <div className="proxy-group-card-actions">
                  <Button size="small" icon={<EditOutlined />} onClick={(event) => openEditGroupModal(event, group)} onKeyDown={(event) => event.stopPropagation()}>{isManagedGroup ? "覆写成员" : "编辑"}</Button>
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
        title={activeNodeGroup ? `选择代理 - ${activeNodeGroup.name}` : "选择代理"}
        width={860}
        className="node-picker-modal"
        destroyOnHidden
      >
        <div className="proxy-node-picker-toolbar">
          <div className="proxy-node-picker-filters">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="模糊搜索节点或代理组名称"
              value={pickerSearch}
              onChange={(event) => setPickerSearch(event.target.value)}
            />
            <Select<ContinentFilter>
              value={pickerContinent}
              options={continentOptions}
              onChange={setPickerContinent}
            />
          </div>
          <Flex align="center" gap={10}>
            <Text type="secondary">{filteredPickerNodes.length} 个节点 · {filteredPickerGroups.length} 个代理组</Text>
            <Button type="primary" onClick={testNodes} loading={testingNodeIds.length > 0} disabled={!pickerNodes.length}>测试</Button>
          </Flex>
        </div>
        {filteredPickerGroups.length > 0 && (
          <section className="proxy-picker-section">
            <Text strong>代理组</Text>
            <div className="proxy-node-picker-list proxy-group-picker-list">
              {filteredPickerGroups.map((group) => {
                const isSelected = group.id === activeNodeGroup?.currentNodeId;
                const isBuiltinPolicy = isDirectOrRejectProxyGroup(group);
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`${isSelected ? "selected" : ""}${isRuntimeManagedGroup ? " auto-managed" : ""}`}
                    aria-disabled={isRuntimeManagedGroup}
                    disabled={isRuntimeManagedGroup}
                    onClick={() => selectPickerGroup(group)}
                  >
                    <span className="proxy-node-picker-card-head">
                      <Radio checked={isSelected} disabled={isRuntimeManagedGroup} />
                      <Tag color={isBuiltinPolicy ? "default" : "purple"}>{isBuiltinPolicy ? "内置策略" : "代理组"}</Tag>
                    </span>
                    <span className="proxy-node-picker-name"><strong>{group.name}</strong><small>{group.type}</small></span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {sortedPickerNodes.length > 0 && (
          <section className="proxy-picker-section">
            <Text strong>节点</Text>
            <div className="proxy-node-picker-list">
              {sortedPickerNodes.map((node) => {
                const isTesting = testingNodeIds.includes(node.id);
                const isSelected = node.id === activeNodeGroup?.currentNodeId;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`${isSelected ? "selected" : ""}${isRuntimeManagedGroup ? " auto-managed" : ""}`}
                    aria-disabled={isRuntimeManagedGroup || !node.available || isTesting}
                    disabled={!node.available || isTesting}
                    onClick={() => selectPickerNode(node)}
                  >
                    <span className="proxy-node-picker-card-head">
                      <Radio checked={isSelected} disabled={isRuntimeManagedGroup} />
                      {node.flag && <span className="flag">{node.flag}</span>}
                    </span>
                    <span className="proxy-node-picker-name"><strong>{node.name}</strong><small>{[getNodeContinent(node), node.country, node.protocol].filter(Boolean).join(" · ")}</small></span>
                    <span className="proxy-node-picker-latency">
                      {!node.available ? <Tag color="default">不可用</Tag> : isTesting ? <><Spin size="small" />测速中</> : <Latency value={getDisplayedLatency(node)} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {!filteredPickerGroups.length && !sortedPickerNodes.length && (
          <Empty className="proxy-node-picker-empty" description="没有符合条件的节点或代理组" />
        )}
      </Modal>

      <Modal open={groupModalOpen} onCancel={closeGroupModal} onOk={() => void saveGroup()} okText="保存" cancelText="取消" title={isEditingManagedGroup ? "本地覆写托管代理组成员" : editingGroup ? "编辑代理组" : "新增代理组"} width={1040} className="form-modal" destroyOnHidden>
        <Form<GroupFormValues> form={groupForm} layout="vertical" initialValues={defaultGroupFormValues}>
          {isEditingManagedGroup ? (
            <>
              <Panel title="覆写说明" className="modal-section">
                <Text>目标托管代理组：<Text strong>{editingGroup?.name}</Text>。此处仅保存本地附加代理组，不修改订阅原始配置；订阅更新后会自动重新叠加。</Text>
              </Panel>
              <Panel title="本地附加代理组" extra={<Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Tag color="purple">已选 {(getFieldValue("groupIds") as string[] | undefined)?.length ?? 0} 项</Tag>}</Form.Item>} className="modal-section">
                {groupSelectableGroups.length ? <Form.Item name="groupIds"><Checkbox.Group className="group-node-checkboxes">{groupSelectableGroups.map((group) => <Checkbox key={group.id} value={group.id}><strong>{group.name}</strong><Tag color="purple">本地代理组</Tag></Checkbox>)}</Checkbox.Group></Form.Item> : <Empty description="请先新增一个本地代理组" />}
              </Panel>
            </>
          ) : (
            <>
              <Panel title="基本设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="类型" name="type"><Select options={groupTypeOptions} /></Form.Item><Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入代理组名称" }]}><Input placeholder="请输入代理组名称" /></Form.Item><Form.Item label="图标" name="icon"><IconPicker /></Form.Item><Form.Item label="说明 / 备注" name="description"><Input placeholder="选填" /></Form.Item></div></Panel>
              <Panel title="策略设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="测试 URL" name="testUrl"><Input /></Form.Item><Form.Item label="测试间隔（秒）" name="interval"><InputNumber min={30} style={{ width: "100%" }} /></Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>{({ getFieldValue }) => getFieldValue("type") === "URL-Test" ? <Form.Item label={toleranceLabel} name="tolerance"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item> : null}</Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>{({ getFieldValue }) => getFieldValue("type") === "Load-Balance" ? <Form.Item label={loadBalanceStrategyLabel} name="loadBalance"><Select options={loadBalanceOptions} /></Form.Item> : null}</Form.Item><Form.Item label={autoTestLabel} name="autoTest" valuePropName="checked"><Switch /></Form.Item></div></Panel>
              <Panel title="节点选择" extra={<Flex align="center" gap={8}><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Tag color="blue">已选 {(getFieldValue("nodeIds") as string[] | undefined)?.length ?? 0} 个节点</Tag>}</Form.Item><Button size="small" onClick={selectAllGroupNodes} disabled={!groupSelectableNodes.length}>全选</Button><Button size="small" onClick={invertGroupNodeSelection} disabled={!groupSelectableNodes.length}>反选</Button></Flex>} className="modal-section">
                <Form.Item name="nodeIds"><Checkbox.Group className="group-node-checkboxes">{groupSelectableNodes.map((node) => <Checkbox key={node.id} value={node.id}>{node.flag && <span className="flag">{node.flag}</span>}<strong>{node.name}</strong><Tag color="blue">{node.protocol}</Tag><Latency value={node.latency} showBars={false} /></Checkbox>)}</Checkbox.Group></Form.Item>
              </Panel>
              <Panel title="代理组与内置策略" extra={<Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Tag color="purple">已选 {(getFieldValue("groupIds") as string[] | undefined)?.length ?? 0} 项</Tag>}</Form.Item>} className="modal-section">
                <Form.Item name="groupIds"><Checkbox.Group className="group-node-checkboxes">{groupSelectableGroups.map((group) => <Checkbox key={group.id} value={group.id}><strong>{group.name}</strong><Tag color={isDirectOrRejectProxyGroup(group) ? "default" : "purple"}>{isDirectOrRejectProxyGroup(group) ? "内置策略" : "代理组"}</Tag></Checkbox>)}</Checkbox.Group></Form.Item>
              </Panel>
              <Panel title="高级设置（可选）" className="modal-section"><div className="form-grid four-columns"><Form.Item label={healthCheckLabel} name="healthCheck" valuePropName="checked"><Switch /></Form.Item><Form.Item label={failureThresholdLabel} name="failureThreshold"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item><Form.Item label={extraParamsLabel} name="extra" className="span-two"><Input placeholder="例如：disable-udp=true, include-all-proxies=true" /></Form.Item></div></Panel>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
