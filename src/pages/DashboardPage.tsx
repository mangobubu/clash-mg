import { useState } from "react";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  GlobalOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { Flex, Radio, Switch, Typography } from "antd";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { useAppStore } from "../store/useAppStore";
import { CompactCopy, Panel, StatusDot } from "../components/Common";

const { Text, Title } = Typography;

const trafficUnits = ["B", "KB", "MB", "GB", "TB"];
const proxyGroupLineColors = ["#9b5de5", "#f15bb5", "#f59e0b", "#14b8a6", "#64748b", "#ef4444", "#8b5cf6"];
const megabyteInBytes = 1024 ** 2;
const downloadSeriesKey = "download";
const uploadSeriesKey = "upload";

function getProxyGroupTrafficKey(groupId: string) {
  return `proxyGroupTraffic_${groupId}`;
}

function formatTrafficValue(valueInMegabytes: number) {
  let value = valueInMegabytes * megabyteInBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < trafficUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || Number.isInteger(value) ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${trafficUnits[unitIndex]}`;
}

export function DashboardPage() {
  const [range, setRange] = useState("24h");
  const [hiddenTrafficSeries, setHiddenTrafficSeries] = useState<Record<string, boolean>>({});
  const {
    connected,
    groups,
    runtime,
    settings,
    trafficHistory,
    updateSetting,
  } = useAppStore();
  const realtimeTraffic = {
    download: { total: runtime.downloadTotal, share: runtime.controllerConnected ? "50%" : "0%" },
    upload: { total: runtime.uploadTotal, share: runtime.controllerConnected ? "50%" : "0%" },
    total: runtime.downloadTotal === "0 B" && runtime.uploadTotal === "0 B" ? "0 B" : `${runtime.downloadTotal} / ${runtime.uploadTotal}`,
  };
  const proxyGroupSeries = groups.map((group, index) => ({
    id: group.id,
    key: getProxyGroupTrafficKey(group.id),
    name: group.name,
    color: proxyGroupLineColors[index % proxyGroupLineColors.length],
  }));
  const trafficChartData = trafficHistory;
  const isTrafficSeriesVisible = (key: string) => !hiddenTrafficSeries[key];
  const visibleTrafficSeriesKeys = [
    ...(isTrafficSeriesVisible(downloadSeriesKey) ? [downloadSeriesKey] : []),
    ...(isTrafficSeriesVisible(uploadSeriesKey) ? [uploadSeriesKey] : []),
    ...proxyGroupSeries.filter((series) => isTrafficSeriesVisible(series.key)).map((series) => series.key),
  ];
  const trafficYAxisMax = Math.max(
    1,
    ...trafficChartData.flatMap((item) => visibleTrafficSeriesKeys.map((key) => Number(item[key] ?? 0))),
  );
  const trafficYAxisTicks = Array.from({ length: 5 }, (_, index) => (trafficYAxisMax / 4) * index);

  const toggleSetting = (key: string) => updateSetting(key, !Boolean(settings[key]));
  const toggleTrafficSeries = (key: string) => {
    setHiddenTrafficSeries((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="dashboard-page page-stack">
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <Panel
            className="connection-overview"
            title={<Flex align="center" gap={18}><Title level={3}>网络连接</Title><StatusDot status={connected ? "success" : "default"}>{connected ? "已连接" : "已暂停"}</StatusDot></Flex>}
          >
            <div className="connection-summary">
              <div className="connection-main">
                  <div className="connection-details">
                    <div className="ip-details">
                    <dl><dt>控制器</dt><dd>{runtime.controllerUrl} <CompactCopy text={runtime.controllerUrl} /></dd></dl>
                    <dl><dt>核心版本</dt><dd>{runtime.coreVersion}</dd></dl>
                  </div>
                </div>
                <div className="quick-toggles">
                  <QuickToggle icon={<WifiOutlined />} tone="green" label="TUN 模式" value={Boolean(settings.tunMode)} onChange={() => toggleSetting("tunMode")} />
                  <QuickToggle icon={<DashboardOutlined />} tone="cyan" label="系统代理" value={Boolean(settings.systemProxy)} onChange={() => toggleSetting("systemProxy")} />
                </div>
              </div>

              <div className="connection-traffic">
                <div className="connection-section-head">
                  <strong>实时流量</strong>
                  <Text type="secondary">当前传输</Text>
                </div>
                <div className="traffic-metrics">
                  <TrafficMetric icon={<ArrowDownOutlined />} label="下载总量" value={realtimeTraffic.download.total} unit="" tone="green" />
                  <TrafficMetric icon={<ArrowUpOutlined />} label="上传总量" value={realtimeTraffic.upload.total} unit="" tone="blue" />
                  <TrafficMetric icon={<GlobalOutlined />} label="控制器" value={runtime.controllerConnected ? "已连接" : "未连接"} unit="" tone="slate" />
                </div>
                <div className="traffic-distribution">
                  <div className="traffic-share">
                    <div className="traffic-share-bar" aria-hidden="true">
                      <span className="download" style={{ width: realtimeTraffic.download.share }} />
                      <span className="upload" style={{ width: realtimeTraffic.upload.share }} />
                    </div>
                    <div className="traffic-share-labels">
                      <span><i className="green-dot" />下载 {realtimeTraffic.download.total}</span>
                      <span><i className="blue-dot" />上传 {realtimeTraffic.upload.total}</span>
                    </div>
                  </div>
                  <div className="distribution-list">
                    <dl><dt><i className="green-dot" /> 下载流量</dt><dd>{realtimeTraffic.download.total} <span>{runtime.lastSync}</span></dd></dl>
                    <dl><dt><i className="blue-dot" /> 上传流量</dt><dd>{realtimeTraffic.upload.total} <span>{runtime.lastSync}</span></dd></dl>
                    <dl><dt>控制器</dt><dd>{runtime.controllerUrl}</dd></dl>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            className="traffic-history"
            title={<Flex align="baseline" gap={12}><Title level={3}>连接统计</Title><Text type="secondary">（最近 {range === "24h" ? "24 小时" : range === "7d" ? "7 天" : "30 天"}）</Text></Flex>}
          >
            <div className="traffic-history-layout">
              <div className="traffic-chart-pane">
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trafficChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="downloadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#19b96c" stopOpacity={0.28} /><stop offset="1" stopColor="#19b96c" stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="uploadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1677ff" stopOpacity={0.22} /><stop offset="1" stopColor="#1677ff" stopOpacity={0.01} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--border-color)" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} domain={[0, trafficYAxisMax]} ticks={trafficYAxisTicks} tickFormatter={formatTrafficValue} width={72} />
                    <ChartTooltip formatter={(value, name) => [formatTrafficValue(Number(value)), name]} contentStyle={{ borderRadius: 10, borderColor: "var(--border-color)", background: "var(--panel)" }} />
                    {isTrafficSeriesVisible(downloadSeriesKey) && <Area type="monotone" dataKey={downloadSeriesKey} name="下载" stroke="#15ad62" strokeWidth={2} fill="url(#downloadFill)" />}
                    {isTrafficSeriesVisible(uploadSeriesKey) && <Area type="monotone" dataKey={uploadSeriesKey} name="上传" stroke="#1677ff" strokeWidth={2} fill="url(#uploadFill)" />}
                    {proxyGroupSeries.filter((series) => isTrafficSeriesVisible(series.key)).map((series) => (
                      <Line key={series.id} type="monotone" dataKey={series.key} name={series.name} stroke={series.color} strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <Flex justify="center"><Radio.Group value={range} onChange={(event) => setRange(event.target.value)} optionType="button" buttonStyle="solid" size="small" options={[{ label: "24 小时", value: "24h" }, { label: "7 天", value: "7d" }, { label: "30 天", value: "30d" }]} /></Flex>
              </div>
              <div className="traffic-legend" aria-label="曲线显示控制">
                <button type="button" className={`legend legend-button download${isTrafficSeriesVisible(downloadSeriesKey) ? "" : " is-hidden"}`} aria-pressed={isTrafficSeriesVisible(downloadSeriesKey)} onClick={() => toggleTrafficSeries(downloadSeriesKey)}>下载</button>
                <button type="button" className={`legend legend-button upload${isTrafficSeriesVisible(uploadSeriesKey) ? "" : " is-hidden"}`} aria-pressed={isTrafficSeriesVisible(uploadSeriesKey)} onClick={() => toggleTrafficSeries(uploadSeriesKey)}>上传</button>
                {proxyGroupSeries.map((series) => (
                  <button key={series.id} type="button" className={`legend legend-button proxy-group${isTrafficSeriesVisible(series.key) ? "" : " is-hidden"}`} style={{ color: series.color }} aria-pressed={isTrafficSeriesVisible(series.key)} onClick={() => toggleTrafficSeries(series.key)}>{series.name}</button>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>

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
