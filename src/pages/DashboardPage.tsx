import { useMemo, useState } from "react";
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  SwapOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  CloudDownloadOutlined,
  DashboardOutlined,
  GlobalOutlined,
  SafetyCertificateFilled,
  SafetyOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { Button, Flex, Modal, Radio, Select, Switch, Tag, Typography, message } from "antd";
import { Area, AreaChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { trafficData } from "../mocks/data";
import { useAppStore } from "../store/useAppStore";
import { CompactCopy, Latency, Panel, StatusDot } from "../components/Common";

const { Text, Title } = Typography;

export function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState("24h");
  const [switchOpen, setSwitchOpen] = useState(false);
  const {
    connected,
    setConnected,
    selectedNodeId,
    selectNode,
    nodes,
    settings,
    updateSetting,
    activities,
  } = useAppStore();
  const currentNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const bestNodes = useMemo(() => [...nodes].sort((a, b) => a.latency - b.latency).slice(0, 5), [nodes]);
  const pieData = [{ name: "下载", value: 13.64, fill: "#16b86a" }, { name: "上传", value: 4.98, fill: "#1677ff" }];

  const toggleSetting = (key: string) => updateSetting(key, !Boolean(settings[key]));

  return (
    <div className="dashboard-page page-stack">
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <Panel
            className="connection-overview"
            title={<Flex align="center" gap={18}><Title level={3}>网络连接</Title><StatusDot status={connected ? "success" : "default"}>{connected ? "已连接" : "已暂停"}</StatusDot></Flex>}
            extra={<Button icon={<SwapOutlined />} onClick={() => setSwitchOpen(true)}>切换节点</Button>}
          >
            <div className="connection-summary">
              <div className="connection-details">
                <dl><dt>代理模式</dt><dd><button className="link-button" onClick={() => navigate("/settings/general")}>{String(settings.proxyMode)}</button></dd></dl>
                <dl><dt>当前节点</dt><dd><span>{currentNode.flag}</span> {currentNode.name}</dd></dl>
                <dl><dt>延迟</dt><dd><Latency value={currentNode.latency} showBars={false} /></dd></dl>
                <div className="ip-details">
                  <dl><dt>本地 IP</dt><dd>192.168.1.100 <CompactCopy text="192.168.1.100" /></dd></dl>
                  <dl><dt>出口 IP</dt><dd>103.162.245.76 <CompactCopy text="103.162.245.76" /></dd></dl>
                </div>
              </div>
              <div className="quick-toggles">
                <QuickToggle icon={<SafetyCertificateFilled />} tone="blue" label="DNS 状态" value={Boolean(settings.dnsEnabled)} onChange={() => toggleSetting("dnsEnabled")} statusText={settings.dnsEnabled ? "正常" : "停用"} />
                <QuickToggle icon={<WifiOutlined />} tone="green" label="TUN 模式" value={Boolean(settings.tunMode)} onChange={() => toggleSetting("tunMode")} />
                <QuickToggle icon={<DashboardOutlined />} tone="cyan" label="系统代理" value={Boolean(settings.systemProxy)} onChange={() => toggleSetting("systemProxy")} />
                <QuickToggle icon={<SafetyOutlined />} tone="green" label="防火墙" value={Boolean(settings.firewall)} onChange={() => toggleSetting("firewall")} />
              </div>
            </div>
          </Panel>

          <Panel
            className="traffic-history"
            title={<Flex align="baseline" gap={12}><Title level={3}>连接统计</Title><Text type="secondary">（最近 {range === "24h" ? "24 小时" : range === "7d" ? "7 天" : "30 天"}）</Text></Flex>}
            extra={<Flex gap={18}><span className="legend download">下载 (MB)</span><span className="legend upload">上传 (MB)</span></Flex>}
          >
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trafficData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="downloadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#19b96c" stopOpacity={0.28} /><stop offset="1" stopColor="#19b96c" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="uploadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1677ff" stopOpacity={0.22} /><stop offset="1" stopColor="#1677ff" stopOpacity={0.01} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} unit=" MB" />
                <ChartTooltip contentStyle={{ borderRadius: 10, borderColor: "var(--border-color)", background: "var(--panel)" }} />
                <Area type="monotone" dataKey="download" name="下载" stroke="#15ad62" strokeWidth={2} fill="url(#downloadFill)" />
                <Area type="monotone" dataKey="upload" name="上传" stroke="#1677ff" strokeWidth={2} fill="url(#uploadFill)" />
              </AreaChart>
            </ResponsiveContainer>
            <Flex justify="center"><Radio.Group value={range} onChange={(event) => setRange(event.target.value)} optionType="button" buttonStyle="solid" size="small" options={[{ label: "24 小时", value: "24h" }, { label: "7 天", value: "7d" }, { label: "30 天", value: "30d" }]} /></Flex>
          </Panel>
        </div>

        <div className="dashboard-secondary">
          <Panel
            className="realtime-panel"
            title={<Title level={3}>实时流量</Title>}
            extra={<Select size="small" value="realtime" options={[{ label: "实时", value: "realtime" }, { label: "近 5 分钟", value: "5m" }]} />}
          >
            <div className="traffic-metrics">
              <TrafficMetric icon={<ArrowDownOutlined />} label="下载速度" value="12.45" unit="MB/s" tone="green" />
              <TrafficMetric icon={<ArrowUpOutlined />} label="上传速度" value="2.34" unit="MB/s" tone="blue" />
              <TrafficMetric icon={<GlobalOutlined />} label="总流量" value="18.62" unit="GB" tone="slate" />
            </div>
            <div className="traffic-distribution">
              <ResponsiveContainer width={128} height={112}>
                <PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={32} outerRadius={46} paddingAngle={0} /></PieChart>
              </ResponsiveContainer>
              <div className="distribution-list">
                <dl><dt><i className="green-dot" /> 下载流量</dt><dd>13.64 GB <span>73.3%</span></dd></dl>
                <dl><dt><i className="blue-dot" /> 上传流量</dt><dd>4.98 GB <span>26.7%</span></dd></dl>
                <dl><dt>合计</dt><dd>18.62 GB</dd></dl>
              </div>
            </div>
          </Panel>

          <Panel className="node-status-panel" title={<Title level={3}>节点状态</Title>} extra={<Button type="link" onClick={() => navigate("/proxies")}>更多节点 <ArrowRightOutlined /></Button>}>
            <div className="compact-node-list">
              {bestNodes.map((node) => (
                <button key={node.id} className={node.id === selectedNodeId ? "is-current" : ""} onClick={() => { selectNode(node.id); message.success(`已切换至 ${node.name}`); }}>
                  <span className="flag">{node.flag}</span>
                  <span><strong>{node.name}</strong><small>{node.protocol}</small></span>
                  {node.id === selectedNodeId && <Tag color="cyan">当前</Tag>}
                  <Latency value={node.latency} />
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="activity-panel" title={<Title level={3}>最近活动</Title>} extra={<Button type="link" onClick={() => navigate("/logs")}>查看全部 <ArrowRightOutlined /></Button>}>
            <div className="activity-list">
              {activities.slice(0, 5).map((activity) => (
                <div key={activity.id}>
                  <span className={`activity-icon ${activity.kind}`}>{activity.kind === "success" ? <CheckCircleFilled /> : activity.kind === "update" ? <CloudDownloadOutlined /> : <SwapOutlined />}</span>
                  <span>{activity.content}</span>
                  <time>{activity.time}</time>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="connection-control-bar">
        <Flex align="center" gap={12}><span className={`power-indicator${connected ? " active" : ""}`} /><strong>{connected ? "代理服务正在运行" : "代理服务已暂停"}</strong></Flex>
        <Switch checked={connected} onChange={setConnected} checkedChildren="运行" unCheckedChildren="暂停" />
      </div>

      <Modal open={switchOpen} onCancel={() => setSwitchOpen(false)} footer={null} title="切换节点" width={720}>
        <div className="node-picker-grid">
          {nodes.filter((node) => node.available).map((node) => (
            <button key={node.id} className={node.id === selectedNodeId ? "selected" : ""} onClick={() => { selectNode(node.id); setSwitchOpen(false); message.success(`已切换至 ${node.name}`); }}>
              <span className="flag">{node.flag}</span>
              <span><strong>{node.name}</strong><small>{node.protocol}</small></span>
              <Latency value={node.latency} />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function QuickToggle({ icon, tone, label, value, onChange, statusText }: { icon: React.ReactNode; tone: string; label: string; value: boolean; onChange: () => void; statusText?: string }) {
  return (
    <div className="quick-toggle">
      <span className={`quick-icon ${tone}`}>{icon}</span>
      <span><strong>{label}</strong>{statusText && <StatusDot status={value ? "success" : "default"}>{statusText}</StatusDot>}</span>
      <Switch checked={value} onChange={onChange} />
    </div>
  );
}

function TrafficMetric({ icon, label, value, unit, tone }: { icon: React.ReactNode; label: string; value: string; unit: string; tone: string }) {
  return (
    <div className={`traffic-metric ${tone}`}>
      <Text>{icon} {label}</Text>
      <div><strong>{value}</strong> <span>{unit}</span></div>
      <svg viewBox="0 0 100 16" preserveAspectRatio="none"><path d="M0 10 L6 7 L12 11 L18 5 L24 10 L30 6 L36 12 L42 7 L48 10 L54 4 L60 8 L66 6 L72 11 L78 5 L84 9 L90 6 L100 8" fill="none" vectorEffect="non-scaling-stroke" /></svg>
    </div>
  );
}
