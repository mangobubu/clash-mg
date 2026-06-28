import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { HintBar, Latency, PageHeader, Panel } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { NodeProtocol, ProxyGroup, ProxyNode } from "../types";
import { compareProxyNodesByLatency } from "../utils/nodeLatency";
import { continentOptions, getNodeContinent, type ContinentFilter } from "../utils/nodeLocation";

const { Text, Title } = Typography;
const { TextArea } = Input;

interface NodeFormValues {
  protocol: NodeProtocol;
  name: string;
  address: string;
  port: number;
  password?: string;
  cipher?: string;
  dialerProxy?: string;
  proxyGroupIds: string[];
  remark?: string;
  available: boolean;
  link?: string;
}

const protocolOptions: Array<{ label: string; value: NodeProtocol }> = [
  { label: "Shadowsocks", value: "Shadowsocks" },
  { label: "VMess", value: "VMess" },
  { label: "Trojan", value: "Trojan" },
  { label: "Hysteria2", value: "Hysteria2" },
];

const cipherOptions = [
  { label: "aes-128-gcm", value: "aes-128-gcm" },
  { label: "aes-256-gcm", value: "aes-256-gcm" },
  { label: "chacha20-ietf-poly1305", value: "chacha20-ietf-poly1305" },
  { label: "auto", value: "auto" },
];

const getNodeAddress = (node: ProxyNode) => `${node.address}:${node.port}`;
const nodeLinkPattern = /^(ss|vmess|trojan|hysteria2):\/\//i;
const canProxyGroupContainNodes = (group: ProxyGroup) => group.type !== "Direct" && group.type !== "Block";
const getNodeOrigin = (node: ProxyNode) => node.origin ?? "managed";
export function NodesPage() {
  const { nodes, groups, addNode, updateNode, updateGroup, testNodeLatency } = useAppStore();
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<NodeProtocol | "all">("all");
  const [continentFilter, setContinentFilter] = useState<ContinentFilter>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "unavailable">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null);
  const [testingNodeIds, setTestingNodeIds] = useState<string[]>([]);
  const testTimerRefs = useRef<number[]>([]);
  const [form] = Form.useForm<NodeFormValues>();
  const watchedProxyGroupIds = Form.useWatch("proxyGroupIds", form) ?? [];
  const watchedDialerProxy = Form.useWatch("dialerProxy", form);
  const isEditingManagedNode = editingNode ? getNodeOrigin(editingNode) === "managed" : false;

  const groupOptions = useMemo(
    () => Array.from(new Set(nodes.map((node) => node.group).filter((group): group is string => Boolean(group)))).map((group) => ({ label: group, value: group })),
    [nodes],
  );
  const proxyGroupOptions = useMemo(
    () => groups
      .filter(canProxyGroupContainNodes)
      .map((group) => ({ label: group.name, value: group.id })),
    [groups],
  );
  const selectedProxyGroupIdSet = useMemo(() => new Set(watchedProxyGroupIds), [watchedProxyGroupIds]);
  const dialerProxyOptions = useMemo(() => {
    const nodeOptions = nodes
      .filter((node) => node.id !== editingNode?.id)
      .map((node) => ({ label: node.name, value: node.name }));
    const proxyGroupDialerOptions = groups
      .filter(canProxyGroupContainNodes)
      .filter((group) => !editingNode || (!group.nodeIds.includes(editingNode.id) && !selectedProxyGroupIdSet.has(group.id)))
      .map((group) => ({ label: group.name, value: group.name }));
    return [
      { label: "其他节点", options: nodeOptions },
      { label: "自身不在的代理组", options: proxyGroupDialerOptions },
    ].filter((group) => group.options.length > 0);
  }, [editingNode?.id, groups, nodes, selectedProxyGroupIdSet]);
  const dialerProxyValues = useMemo(
    () => new Set(dialerProxyOptions.flatMap((group) => group.options.map((option) => option.value))),
    [dialerProxyOptions],
  );

  const filteredNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return nodes.filter((node) => {
      const matchesKeyword = !keyword || `${node.name}${node.country ?? ""}${node.address}${node.protocol}${node.group ?? ""}`.toLowerCase().includes(keyword);
      const matchesProtocol = protocolFilter === "all" || node.protocol === protocolFilter;
      const matchesContinent = continentFilter === "all" || getNodeContinent(node) === continentFilter;
      const matchesAvailability = availabilityFilter === "all"
        || (availabilityFilter === "available" && node.available)
        || (availabilityFilter === "unavailable" && !node.available);
      return matchesKeyword && matchesProtocol && matchesContinent && matchesAvailability;
    }).sort(compareProxyNodesByLatency);
  }, [availabilityFilter, continentFilter, nodes, protocolFilter, search]);

  const availableCount = nodes.filter((node) => node.available).length;
  const testedCount = nodes.filter((node) => node.latency > 0).length;
  const bestNode = nodes
    .filter((node) => node.available && node.latency > 0)
    .reduce<ProxyNode | null>((best, node) => (!best || node.latency < best.latency ? node : best), null);

  const clearTestTimers = () => {
    testTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    testTimerRefs.current = [];
  };

  useEffect(() => clearTestTimers, []);
  useEffect(() => {
    if (watchedDialerProxy && !dialerProxyValues.has(watchedDialerProxy)) {
      form.setFieldValue("dialerProxy", undefined);
    }
  }, [dialerProxyValues, form, watchedDialerProxy]);

  const getNodeProxyGroupIds = (nodeId: string) =>
    groups
      .filter((group) => canProxyGroupContainNodes(group) && group.nodeIds.includes(nodeId))
      .map((group) => group.id);

  const openAddModal = () => {
    setEditingNode(null);
    form.resetFields();
    form.setFieldsValue({
      protocol: "Shadowsocks",
      name: "",
      address: "",
      port: 8388,
      password: "",
      cipher: "aes-128-gcm",
      dialerProxy: "",
      proxyGroupIds: proxyGroupOptions.some((group) => group.value === "manual")
        ? ["manual"]
        : proxyGroupOptions.slice(0, 1).map((group) => group.value),
      remark: "",
      available: true,
      link: "",
    });
    setModalOpen(true);
  };

  const openEditModal = (node: ProxyNode) => {
    setEditingNode(node);
    form.resetFields();
    form.setFieldsValue({
      protocol: node.protocol,
      name: node.name,
      address: node.address,
      port: node.port,
      password: node.password ?? "",
      cipher: node.cipher ?? "aes-128-gcm",
      dialerProxy: node.dialerProxy,
      proxyGroupIds: getNodeProxyGroupIds(node.id),
      remark: "",
      available: node.available,
      link: "",
    });
    setModalOpen(true);
  };

  const handleNodeCardKeyDown = (event: KeyboardEvent<HTMLElement>, node: ProxyNode) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEditModal(node);
    }
  };

  const closeNodeModal = () => {
    setModalOpen(false);
    setEditingNode(null);
    form.resetFields();
  };

  const parseLinkPlaceholder = () => {
    const link = form.getFieldValue("link")?.trim();
    if (!link) {
      message.warning("请先粘贴节点链接");
      return;
    }
    if (!nodeLinkPattern.test(link)) {
      message.warning("请粘贴 ss://、vmess://、trojan:// 或 hysteria2:// 节点链接");
      return;
    }
    message.info("节点链接解析尚未写入 Mihomo 配置，请先在表单中保存节点");
  };

  const syncNodeProxyGroups = (nodeId: string, proxyGroupIds: string[]) => {
    const selectedGroupIdSet = new Set(proxyGroupIds);
    groups
      .filter(canProxyGroupContainNodes)
      .forEach((group) => {
        const hasNode = group.nodeIds.includes(nodeId);
        const shouldHaveNode = selectedGroupIdSet.has(group.id);
        if (hasNode === shouldHaveNode) return;
        const nextNodeIds = shouldHaveNode ? [...group.nodeIds, nodeId] : group.nodeIds.filter((id) => id !== nodeId);
        updateGroup({
          ...group,
          nodeIds: nextNodeIds,
          currentNodeId: shouldHaveNode && !group.currentNodeId
            ? nodeId
            : group.currentNodeId === nodeId && !shouldHaveNode
              ? nextNodeIds[0]
              : group.currentNodeId,
        });
      });
  };

  const saveNode = async () => {
    if (editingNode && isEditingManagedNode) {
      const dialerProxy = (form.getFieldValue("dialerProxy") as string | undefined)?.trim() || undefined;
      updateNode({ ...editingNode, dialerProxy });
      closeNodeModal();
      message.success("托管节点前置代理已更新");
      return;
    }

    const values = await form.validateFields();
    const dialerProxy = values.dialerProxy?.trim() || undefined;
    if (editingNode) {
      const node: ProxyNode = {
        ...editingNode,
        name: values.name.trim(),
        protocol: values.protocol,
        address: values.address.trim(),
        port: values.port,
        password: values.password?.trim() || undefined,
        cipher: values.cipher,
        dialerProxy,
        origin: "local",
        available: values.available,
      };
      updateNode(node);
      syncNodeProxyGroups(node.id, values.proxyGroupIds);
      closeNodeModal();
      message.success("节点已保存");
      return;
    }

    const nodeId = crypto.randomUUID();
    const node: ProxyNode = {
      id: nodeId,
      name: values.name.trim(),
      protocol: values.protocol,
      address: values.address.trim(),
      port: values.port,
      latency: 0,
      password: values.password?.trim() || undefined,
      cipher: values.cipher,
      dialerProxy,
      origin: "local",
      available: values.available,
    };
    addNode(node);
    syncNodeProxyGroups(nodeId, values.proxyGroupIds);
    closeNodeModal();
    message.success(`节点已添加到 ${values.proxyGroupIds.length} 个代理组，建议立即测速确认可用性`);
  };

  const copyAddress = async (node: ProxyNode) => {
    const address = getNodeAddress(node);
    try {
      await navigator.clipboard.writeText(address);
      message.success("节点地址已复制");
    } catch {
      message.info(`节点地址：${address}`);
    }
  };

  const runLatencyTest = (targetNodes: ProxyNode[]) => {
    const testingSet = new Set(testingNodeIds);
    const candidates = targetNodes.filter((node) => !testingSet.has(node.id));
    if (!candidates.length) {
      message.info("当前没有可测速的节点");
      return;
    }

    setTestingNodeIds((ids) => Array.from(new Set([...ids, ...candidates.map((node) => node.id)])));
    let finishedCount = 0;

    candidates.forEach((node, index) => {
      const timer = window.setTimeout(() => {
        void testNodeLatency(node.id).then(() => {
          setTestingNodeIds((ids) => ids.filter((id) => id !== node.id));
          finishedCount += 1;

          if (finishedCount === candidates.length) {
            message.success(candidates.length === 1 ? `${node.name} 测速完成` : `已完成 ${candidates.length} 个节点测速`);
          }
        });
      }, 320 + index * 120);
      testTimerRefs.current.push(timer);
    });
  };

  const resetFilters = () => {
    setSearch("");
    setProtocolFilter("all");
    setContinentFilter("all");
    setAvailabilityFilter("all");
  };

  return (
    <div className="page-stack nodes-page">
      <PageHeader
        title="节点"
        description="集中维护本地节点，支持新增、筛选与延迟测试。"
        actions={(
          <>
            <Button icon={<ReloadOutlined />} onClick={() => runLatencyTest(filteredNodes)} loading={testingNodeIds.length > 0} disabled={!filteredNodes.length}>批量测速</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>新增节点</Button>
          </>
        )}
      />

      <div className="nodes-overview">
        <Panel className="node-stat-card">
          <Text type="secondary">节点总数</Text>
          <strong>{nodes.length}</strong>
          <span>覆盖 {groupOptions.length} 个分组</span>
        </Panel>
        <Panel className="node-stat-card">
          <Text type="secondary">可用节点</Text>
          <strong>{availableCount}</strong>
          <span>不可用 {nodes.length - availableCount} 个</span>
        </Panel>
        <Panel className="node-stat-card">
          <Text type="secondary">已测速</Text>
          <strong>{testedCount}</strong>
          <span>{testingNodeIds.length ? `${testingNodeIds.length} 个测速中` : "当前无测速任务"}</span>
        </Panel>
        <Panel className="node-stat-card">
          <Text type="secondary">最低延迟</Text>
          <strong>{bestNode ? `${bestNode.latency} ms` : "—"}</strong>
          <span>{bestNode?.name ?? "暂无可用结果"}</span>
        </Panel>
      </div>

      <Panel className="nodes-list-panel" title={<Title level={3}>节点列表</Title>}>
        <div className="filter-bar nodes-filter-bar">
          <Input prefix={<SearchOutlined />} placeholder="搜索节点名称 / 地址 / 协议" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
          <Select<NodeProtocol | "all"> value={protocolFilter} onChange={setProtocolFilter} options={[{ label: "所有协议", value: "all" }, ...protocolOptions]} />
          <Select<ContinentFilter> value={continentFilter} onChange={setContinentFilter} options={continentOptions} />
          <Select value={availabilityFilter} onChange={setAvailabilityFilter} options={[{ label: "所有状态", value: "all" }, { label: "可用", value: "available" }, { label: "不可用", value: "unavailable" }]} />
          <Button icon={<ReloadOutlined />} onClick={resetFilters} aria-label="重置筛选" />
        </div>

        {filteredNodes.length ? (
          <div className="nodes-grid">
            {filteredNodes.map((node) => {
              const isTesting = testingNodeIds.includes(node.id);
              return (
                <article
                  className="node-card"
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditModal(node)}
                  onKeyDown={(event) => handleNodeCardKeyDown(event, node)}
                >
                  <div className={`node-card-head${node.flag ? "" : " no-flag"}`}>
                    {node.flag && <span className="node-card-flag">{node.flag}</span>}
                    <span className="node-card-title">
                      <strong>{node.name}</strong>
                      {(node.country || node.group) && <Text type="secondary">{[node.country, node.group].filter(Boolean).join(" · ")}</Text>}
                    </span>
                    <span
                      className={`node-status-beacon ${node.available ? "is-available" : "is-unavailable"}`}
                      aria-label={node.available ? "节点可用" : "节点不可用"}
                      title={node.available ? "节点可用" : "节点不可用"}
                    />
                  </div>

                  <div className="node-card-details">
                    <div className="node-card-protocol-row"><Tag color="blue">{node.protocol}</Tag></div>
                    <div className="node-card-data-row">
                      <span className="node-card-address" title={getNodeAddress(node)}>{getNodeAddress(node)}</span>
                    </div>
                    {node.dialerProxy && <div className="node-card-dialer">前置 {node.dialerProxy}</div>}
                    <div className="node-card-latency-row">
                      <span className="node-card-detail-label">延迟</span>
                      <button
                        type="button"
                        className="node-latency-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          runLatencyTest([node]);
                        }}
                        disabled={isTesting}
                        aria-label={`测试${node.name}延迟`}
                      >
                        {isTesting
                          ? <span className="node-testing"><Spin size="small" />测速中</span>
                          : node.available && node.latency > 0
                            ? <Latency value={node.latency} />
                            : <Text type="secondary">测速</Text>}
                      </button>
                    </div>
                  </div>

                  <div className="node-card-actions" onClick={(event) => event.stopPropagation()}>
                    <Tooltip title="复制地址">
                      <Button icon={<CopyOutlined />} onClick={() => void copyAddress(node)} aria-label="复制地址" />
                    </Tooltip>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <Empty className="nodes-empty" description="没有找到匹配节点" />}
      </Panel>

      <Modal open={modalOpen} onCancel={closeNodeModal} onOk={() => void saveNode()} okText="保存" cancelText="取消" title={editingNode ? "编辑节点" : "新增节点"} width={980} className="form-modal node-form-modal" destroyOnHidden>
        <Form<NodeFormValues> form={form} layout="vertical">
          {!editingNode && (
            <Panel title="链接解析（占位）" className="modal-section node-link-placeholder">
              <Form.Item name="link" label="节点链接">
                <TextArea rows={3} placeholder="粘贴 ss://、vmess://、trojan:// 或 hysteria2:// 节点链接" />
              </Form.Item>
              <Flex align="center" justify="space-between" gap={12} wrap="wrap">
                <Text type="secondary">当前仅预留复制链接解析入口，真实解析逻辑后续接入 Rust 后端。</Text>
                <Button icon={<LinkOutlined />} onClick={parseLinkPlaceholder}>解析链接</Button>
              </Flex>
            </Panel>
          )}

          <Panel title="基本设置" className="modal-section">
            <div className="form-grid four-columns">
              <Form.Item label="类型" name="protocol" rules={[{ required: true, message: "请选择节点类型" }]}><Select options={protocolOptions} disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入节点名称" }]}><Input placeholder="请输入节点名称" disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="地址" name="address" rules={[{ required: true, message: "请输入节点地址" }]} className="span-two"><Input placeholder="节点服务器域名或 IP" disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="端口" name="port" rules={[{ required: true, message: "请输入端口" }]}><InputNumber min={1} max={65535} style={{ width: "100%" }} disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="初始可用" name="available" valuePropName="checked"><Switch checkedChildren={<CheckCircleOutlined />} disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="前置代理（dialer-proxy）" name="dialerProxy" className="span-two">
                <Select allowClear showSearch options={dialerProxyOptions} placeholder="选择其他节点或自身不在的代理组" />
              </Form.Item>
              <Form.Item label="加入代理组" name="proxyGroupIds" className="span-two" rules={isEditingManagedNode ? [] : [{ required: true, message: "请选择至少一个代理组" }]}>
                <Select mode="multiple" options={proxyGroupOptions} placeholder="选择这个节点要加入的代理组" disabled={isEditingManagedNode} />
              </Form.Item>
              <Form.Item label="密码" name="password"><Input.Password placeholder="请输入密码" disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="加密方式" name="cipher"><Select options={cipherOptions} disabled={isEditingManagedNode} /></Form.Item>
              <Form.Item label="备注" name="remark" className="span-two"><Input placeholder="选填，仅用于后续后端保存扩展" disabled={isEditingManagedNode} /></Form.Item>
            </div>
          </Panel>

          <HintBar>{isEditingManagedNode ? "托管节点仅允许修改前置代理，其他配置由订阅或后端托管。" : "保存后会同步更新节点与代理组关系；测速和链接解析后续可替换为 Rust 后端命令。"}</HintBar>
        </Form>
      </Modal>
    </div>
  );
}
