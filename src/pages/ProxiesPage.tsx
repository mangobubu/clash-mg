import { useMemo, useState, type KeyboardEvent } from "react";
import {
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Collapse,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { HintBar, Latency, PageHeader, Panel } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import type { NodeProtocol, ProxyGroup, ProxyGroupType, ProxyNode } from "../types";

const { Text, Title } = Typography;

interface NodeFormValues {
  protocol: NodeProtocol;
  name: string;
  address: string;
  port: number;
  password: string;
  cipher: string;
  note?: string;
  udp: boolean;
  udpOverTcp: boolean;
  plugin?: string;
  pluginOptions?: string;
}

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
  deduplicate: boolean;
  nodeIds: string[];
  allowManual: boolean;
  healthCheck: boolean;
  failureThreshold: number;
  extra?: string;
}

export function ProxiesPage() {
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [protocol, setProtocol] = useState("all");
  const [sortAscending, setSortAscending] = useState(true);
  const [nodeForm] = Form.useForm<NodeFormValues>();
  const [groupForm] = Form.useForm<GroupFormValues>();
  const { nodes, groups, selectedGroupId, selectedNodeId, selectGroup, selectNode, addNode, addGroup, refreshLatencies } = useAppStore();
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0];

  const handleGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>, groupId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectGroup(groupId);
    }
  };

  const visibleNodes = useMemo(() => {
    const allowedIds = activeGroup.nodeIds.length ? activeGroup.nodeIds : nodes.map((node) => node.id);
    return nodes
      .filter((node) => allowedIds.includes(node.id))
      .filter((node) => `${node.name}${node.address}`.toLowerCase().includes(search.toLowerCase()))
      .filter((node) => country === "all" || node.group === country)
      .filter((node) => protocol === "all" || node.protocol === protocol)
      .sort((a, b) => sortAscending ? a.latency - b.latency : b.latency - a.latency);
  }, [activeGroup.nodeIds, country, nodes, protocol, search, sortAscending]);

  const saveNode = async () => {
    const values = await nodeForm.validateFields();
    const node: ProxyNode = {
      id: crypto.randomUUID(),
      name: values.name,
      country: "自定义节点",
      flag: "🌐",
      protocol: values.protocol,
      address: values.address,
      port: values.port,
      latency: 999,
      password: values.password,
      cipher: values.cipher,
      group: "自定义",
      available: true,
    };
    addNode(node);
    nodeForm.resetFields();
    setNodeModalOpen(false);
    message.success("节点已保存，可在节点列表中选择");
  };

  const saveGroup = async () => {
    const values = await groupForm.validateFields();
    const group: ProxyGroup = {
      id: crypto.randomUUID(),
      name: values.name,
      type: values.type,
      icon: values.icon,
      description: values.description ?? "自定义代理组",
      nodeIds: values.nodeIds,
      currentNodeId: values.nodeIds[0],
      autoTest: values.autoTest,
      allowManual: values.allowManual,
    };
    addGroup(group);
    groupForm.resetFields();
    setGroupModalOpen(false);
    message.success("代理组已创建");
  };

  return (
    <div className="page-stack proxies-page">
      <PageHeader
        title="代理"
        description="管理代理组及其节点，灵活切换以满足不同网络需求。"
        actions={<><Button icon={<PlusOutlined />} onClick={() => setNodeModalOpen(true)}>新增节点</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setGroupModalOpen(true)}>新增代理组</Button></>}
      />
      <div className="proxy-layout">
        <Panel
          className="proxy-groups-panel"
          title={<Title level={3}>代理组</Title>}
          extra={<Button icon={<PlusOutlined />} onClick={() => setGroupModalOpen(true)}>新建</Button>}
        >
          <div className="proxy-group-table-head"><span>代理组名称</span><span>类型</span><span>当前节点</span></div>
          <div className="proxy-group-list">
            {groups.map((group) => {
              const current = nodes.find((node) => node.id === group.currentNodeId);
              return (
                <div
                  key={group.id}
                  className={`proxy-group-row${group.id === selectedGroupId ? " selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectGroup(group.id)}
                  onKeyDown={(event) => handleGroupKeyDown(event, group.id)}
                >
                  <span className="group-check">{group.id === selectedGroupId ? "✓" : ""}</span>
                  <span className="group-name"><i>{group.icon}</i>{group.name}</span>
                  <span><Tag color={group.type === "Selector" ? "blue" : group.type === "Block" ? "red" : "default"}>{group.type}</Tag></span>
                  <span className="group-current">{current?.name ?? (group.type === "Direct" ? "直连" : "REJECT")}</span>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [{ key: "rename", label: "重命名" }, { key: "duplicate", label: "复制代理组" }, { key: "delete", danger: true, label: "删除代理组" }],
                      onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation();
                        message.info(`${key === "rename" ? "重命名" : key === "duplicate" ? "复制" : "删除"}操作已触发（Mock）`);
                      },
                    }}
                  >
                    <Button type="text" icon={<MoreOutlined />} onClick={(event) => event.stopPropagation()} />
                  </Dropdown>
                </div>
              );
            })}
          </div>
          <HintBar>选中左侧代理组后，可在右侧选择节点。</HintBar>
        </Panel>

        <Panel className="node-selection-panel" title={<Flex align="baseline" gap={10}><Title level={3}>节点选择</Title><Text type="secondary">（{activeGroup.name}）</Text></Flex>}>
          <div className="filter-bar proxy-filter-bar">
            <Input prefix={<SearchOutlined />} placeholder="搜索节点名称 / 地址" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
            <Select value={country} onChange={setCountry} options={[{ label: "所有分组", value: "all" }, ...Array.from(new Set(nodes.map((node) => node.group))).map((value) => ({ label: value, value }))]} />
            <Select value={protocol} onChange={setProtocol} options={[{ label: "所有协议", value: "all" }, ...Array.from(new Set(nodes.map((node) => node.protocol))).map((value) => ({ label: value, value }))]} />
            <Button onClick={() => setSortAscending(!sortAscending)}>按延迟排序 {sortAscending ? "↑" : "↓"}</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { refreshLatencies(); message.success("节点延迟已刷新"); }} aria-label="刷新延迟" />
          </div>
          {visibleNodes.length ? (
            <div className="node-card-grid">
              {visibleNodes.map((node) => (
                <button
                  key={node.id}
                  className={node.id === selectedNodeId ? "selected" : ""}
                  disabled={!node.available}
                  onClick={() => { selectNode(node.id, activeGroup.id); message.success(`已切换至 ${node.name}`); }}
                >
                  <Radio checked={node.id === selectedNodeId} />
                  <span className="flag">{node.flag}</span>
                  <span className="node-card-name"><strong>{node.name}</strong><small>{node.protocol}</small></span>
                  {!node.available && <Tag color="default">不可用</Tag>}
                  <Latency value={node.latency} />
                </button>
              ))}
            </div>
          ) : <Empty description="当前筛选条件下没有节点" />}
          <div className="selection-summary"><span>当前代理组：{activeGroup.name}</span><span>当前节点：{nodes.find((node) => node.id === selectedNodeId)?.name}（{nodes.find((node) => node.id === selectedNodeId)?.protocol} · {nodes.find((node) => node.id === selectedNodeId)?.latency} ms）</span></div>
        </Panel>
      </div>

      <Modal open={nodeModalOpen} onCancel={() => setNodeModalOpen(false)} onOk={() => void saveNode()} okText="保存" cancelText="取消" title="新增节点" width={920} className="form-modal" destroyOnHidden>
        <Form<NodeFormValues> form={nodeForm} layout="vertical" initialValues={{ protocol: "Shadowsocks", cipher: "aes-128-gcm", udp: true, udpOverTcp: false, port: 8388 }}>
          <Panel title="类型" className="modal-section"><Form.Item name="protocol" noStyle><Select size="large" options={["Shadowsocks", "VMess", "Trojan", "Hysteria2"].map((value) => ({ label: value, value }))} /></Form.Item></Panel>
          <Panel title="基本设置" className="modal-section">
            <div className="form-grid two-columns">
              <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入节点名称" }]}><Input placeholder="请输入节点名称" /></Form.Item>
              <Form.Item label="地址" name="address" rules={[{ required: true, message: "请输入节点地址" }]}><Input placeholder="例如：103.162.245.76" /></Form.Item>
              <Form.Item label="端口" name="port" rules={[{ required: true, message: "请输入端口" }]}><InputNumber min={1} max={65535} style={{ width: "100%" }} /></Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password placeholder="请输入密码" /></Form.Item>
              <Form.Item label="加密方式" name="cipher"><Select options={["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"].map((value) => ({ label: value, value }))} /></Form.Item>
              <Form.Item label="备注" name="note"><Input placeholder="选填" /></Form.Item>
            </div>
          </Panel>
          <Collapse className="modal-collapse" defaultActiveKey={["advanced"]} items={[{ key: "advanced", label: "高级设置（可选）", children: <div className="form-grid two-columns"><Form.Item label="UDP 传输" name="udp" valuePropName="checked"><Switch /></Form.Item><Form.Item label="UDP over TCP" name="udpOverTcp" valuePropName="checked"><Switch /></Form.Item><Form.Item label="插件" name="plugin"><Select allowClear placeholder="选择插件" options={[{ label: "v2ray-plugin", value: "v2ray-plugin" }, { label: "obfs", value: "obfs" }]} /></Form.Item><Form.Item label="插件参数" name="pluginOptions"><Input placeholder="请输入插件参数" /></Form.Item></div> }]} />
          <HintBar>带 * 的字段为必填项，其他均为可选项。</HintBar>
        </Form>
      </Modal>

      <Modal open={groupModalOpen} onCancel={() => setGroupModalOpen(false)} onOk={() => void saveGroup()} okText="保存" cancelText="取消" title="新增代理组" width={1040} className="form-modal" destroyOnHidden>
        <Form<GroupFormValues> form={groupForm} layout="vertical" initialValues={{ type: "Selector", icon: "🌐", testUrl: "https://www.gstatic.com/generate_204", interval: 300, tolerance: 50, loadBalance: "round-robin", autoTest: true, deduplicate: false, nodeIds: nodes.slice(0, 4).map((node) => node.id), allowManual: true, healthCheck: true, failureThreshold: 3 }}>
          <Panel title="基本设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="类型" name="type"><Select options={["Selector", "Fallback", "URL-Test", "Load-Balance"].map((value) => ({ label: value, value }))} /></Form.Item><Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入代理组名称" }]}><Input placeholder="请输入代理组名称" /></Form.Item><Form.Item label="图标" name="icon"><Radio.Group className="icon-radio"><Radio.Button value="🌐">🌐</Radio.Button><Radio.Button value="⚡">⚡</Radio.Button><Radio.Button value="🛡️">🛡️</Radio.Button><Radio.Button value="🎮">🎮</Radio.Button></Radio.Group></Form.Item><Form.Item label="说明 / 备注" name="description"><Input placeholder="选填" /></Form.Item></div></Panel>
          <Panel title="策略设置" className="modal-section"><div className="form-grid four-columns"><Form.Item label="测试 URL" name="testUrl"><Input /></Form.Item><Form.Item label="测试间隔（秒）" name="interval"><InputNumber min={30} style={{ width: "100%" }} /></Form.Item><Form.Item label="容差（ms）" name="tolerance"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item label="负载均衡策略" name="loadBalance"><Select options={[{ label: "round-robin", value: "round-robin" }, { label: "consistent-hashing", value: "consistent-hashing" }]} /></Form.Item><Form.Item label="自动测速" name="autoTest" valuePropName="checked"><Switch /></Form.Item><Form.Item label="去重节点" name="deduplicate" valuePropName="checked"><Switch /></Form.Item></div></Panel>
          <Panel title={<Flex justify="space-between"><span>节点选择</span><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Tag color="blue">已选 {(getFieldValue("nodeIds") as string[] | undefined)?.length ?? 0} 个节点</Tag>}</Form.Item></Flex>} className="modal-section">
            <Form.Item name="nodeIds" rules={[{ required: true, message: "请至少选择一个节点" }]}><Checkbox.Group className="group-node-checkboxes">{nodes.slice(0, 8).map((node) => <Checkbox key={node.id} value={node.id}><span className="flag">{node.flag}</span><strong>{node.name}</strong><Tag color="blue">{node.protocol}</Tag><Latency value={node.latency} showBars={false} /></Checkbox>)}</Checkbox.Group></Form.Item>
          </Panel>
          <Panel title="高级设置（可选）" className="modal-section"><div className="form-grid four-columns"><Form.Item label="允许手动切换" name="allowManual" valuePropName="checked"><Switch /></Form.Item><Form.Item label="使用健康检查" name="healthCheck" valuePropName="checked"><Switch /></Form.Item><Form.Item label="失败切换阈值" name="failureThreshold"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item><Form.Item label="附加参数" name="extra"><Input placeholder="请输入附加参数" /></Form.Item></div></Panel>
        </Form>
      </Modal>
    </div>
  );
}
