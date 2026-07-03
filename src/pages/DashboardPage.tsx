import { useEffect, useState } from "react";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  PlayCircleOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { Button, Flex, Radio, Switch, Typography, message } from "antd";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { useAppStore } from "../store/useAppStore";
import { getLanIp, startMihomoCore } from "../backend/api";
import { CompactCopy, Panel, StatusDot } from "../components/Common";
import { getEffectiveTunSettings, TunServiceControl, useTunService } from "../components/TunServiceControl";
import { buildTrafficChartData, type TrafficRange } from "../utils/trafficHistory";

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

function TrafficChartTooltip({ active, label, payload }: TooltipContentProps) {
  if (!active || payload.length === 0) {
    return null;
  }

  return (
    <div className="traffic-chart-tooltip">
      <div className="traffic-chart-tooltip-label">{String(payload[0]?.payload?.time ?? label ?? "")}</div>
      <div className="traffic-chart-tooltip-list">
        {payload.map((entry, index) => {
          const name = String(entry.name ?? entry.dataKey ?? "");
          const value = formatTrafficValue(Number(entry.value ?? 0));

          return (
            <div className="traffic-chart-tooltip-item" key={`${String(entry.dataKey ?? name)}-${index}`} title={`${name}：${value}`}>
              <i style={{ backgroundColor: entry.color ?? entry.stroke }} aria-hidden="true" />
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<TrafficRange>("24h");
  const [lanIp, setLanIp] = useState("...");
  const [startingCore, setStartingCore] = useState(false);
  useEffect(() => {
    getLanIp().then(setLanIp).catch(console.error);
  }, []);
  const [hiddenTrafficSeries, setHiddenTrafficSeries] = useState<Record<string, boolean>>({});
  const {
    connected,
    groups,
    runtime,
    settings,
    trafficHistory,
    refreshRuntimeData,
    testAutoProxyGroups,
    updateSetting,
  } = useAppStore();
  const { status: tunServiceStatus } = useTunService();
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
  const isTrafficSeriesVisible = (key: string) => !hiddenTrafficSeries[key];
  const trafficSeriesKeys = [downloadSeriesKey, uploadSeriesKey, ...proxyGroupSeries.map((series) => series.key)];
  const visibleTrafficSeriesKeys = trafficSeriesKeys.filter(isTrafficSeriesVisible);
  const trafficChart = buildTrafficChartData(trafficHistory, range, trafficSeriesKeys);
  const trafficChartData = trafficChart.data;
  const trafficYAxisMax = Math.max(
    1,
    ...trafficChartData.flatMap((item) => visibleTrafficSeriesKeys.map((key) => Number(item[key] ?? 0))),
  );
  const trafficYAxisTicks = Array.from({ length: 5 }, (_, index) => (trafficYAxisMax / 4) * index);

  const toggleSetting = (key: string) => updateSetting(key, !Boolean(settings[key]));
  const toggleTrafficSeries = (key: string) => {
    setHiddenTrafficSeries((current) => ({ ...current, [key]: !current[key] }));
  };
  const showAllTrafficSeries = () => setHiddenTrafficSeries({});
  const hideAllTrafficSeries = () => setHiddenTrafficSeries(Object.fromEntries(trafficSeriesKeys.map((key) => [key, true])));
  const startCore = async () => {
    setStartingCore(true);
    try {
      const result = await startMihomoCore(getEffectiveTunSettings(settings, tunServiceStatus));
      if (!result.controllerReady) throw new Error(result.message);
      await refreshRuntimeData();
      if (settings.connectNearest) await testAutoProxyGroups();
      message.success("Mihomo 内核已启动并刷新运行状态");
    } catch (error) {
      message.error({ content: `Mihomo 内核启动失败：${String(error)}`, duration: 6 });
    } finally {
      setStartingCore(false);
    }
  };

  return (
    <div className="dashboard-page page-stack">
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <Panel
            className="connection-overview"
            title={<Flex align="center" gap={18}><Title level={3}>网络连接</Title><StatusDot status={connected ? "success" : "default"}>{connected ? "已连接" : "已暂停"}</StatusDot></Flex>}
            extra={<Button icon={<PlayCircleOutlined />} loading={startingCore} onClick={() => void startCore()}>启动内核</Button>}
          >
            <div className="connection-summary">
              <div className="connection-main">
                  <div className="connection-details">
                    <div className="ip-details">
                    <dl><dt>局域网 IP</dt><dd>{lanIp} <CompactCopy text={lanIp} /></dd></dl>
                    <dl><dt>核心版本</dt><dd>{runtime.coreVersion}</dd></dl>
                  </div>
                </div>
                <div className="quick-toggles">
                  <QuickToggle icon={<WifiOutlined />} tone="green" label="TUN 模式" value={Boolean(settings.tunMode)} onChange={() => toggleSetting("tunMode")} control={<TunServiceControl compact checked={Boolean(settings.tunMode)} />} />
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
                    <dl><dt><i className="green-dot" /> 下载流量</dt><dd>{realtimeTraffic.download.total}</dd></dl>
                    <dl><dt><i className="blue-dot" /> 上传流量</dt><dd>{realtimeTraffic.upload.total}</dd></dl>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            className="traffic-history"
            title={<Flex align="baseline" gap={12}><Title level={3}>连接统计</Title><Text type="secondary">（{range === "24h" ? "今日 0–24 时" : range === "7d" ? "最近 7 天" : "最近 30 天"}）</Text></Flex>}
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
                    <XAxis
                      type="number"
                      dataKey="bucket"
                      domain={trafficChart.domain}
                      ticks={trafficChart.ticks}
                      interval={0}
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted)", fontSize: range === "30d" ? 10 : 12 }}
                      tickFormatter={(value) => trafficChart.tickLabels[Number(value)] ?? ""}
                      angle={range === "30d" ? -45 : 0}
                      textAnchor={range === "30d" ? "end" : "middle"}
                      height={range === "30d" ? 52 : 30}
                      tickMargin={8}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} domain={[0, trafficYAxisMax]} ticks={trafficYAxisTicks} tickFormatter={formatTrafficValue} width={72} />
                    <ChartTooltip content={TrafficChartTooltip} isAnimationActive={false} wrapperStyle={{ pointerEvents: "auto" }} />
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
                <div className="traffic-legend-toolbar">
                  <span>显示曲线</span>
                  <div>
                    <button type="button" disabled={visibleTrafficSeriesKeys.length === trafficSeriesKeys.length} onClick={showAllTrafficSeries}>全选</button>
                    <button type="button" disabled={visibleTrafficSeriesKeys.length === 0} onClick={hideAllTrafficSeries}>清空</button>
                  </div>
                </div>
                <div className="traffic-legend-list">
                  <button type="button" title="下载" className={`legend legend-button download${isTrafficSeriesVisible(downloadSeriesKey) ? "" : " is-hidden"}`} aria-pressed={isTrafficSeriesVisible(downloadSeriesKey)} onClick={() => toggleTrafficSeries(downloadSeriesKey)}>下载</button>
                  <button type="button" title="上传" className={`legend legend-button upload${isTrafficSeriesVisible(uploadSeriesKey) ? "" : " is-hidden"}`} aria-pressed={isTrafficSeriesVisible(uploadSeriesKey)} onClick={() => toggleTrafficSeries(uploadSeriesKey)}>上传</button>
                  {proxyGroupSeries.map((series) => (
                    <button key={series.id} type="button" title={series.name} className={`legend legend-button proxy-group${isTrafficSeriesVisible(series.key) ? "" : " is-hidden"}`} style={{ color: series.color }} aria-pressed={isTrafficSeriesVisible(series.key)} onClick={() => toggleTrafficSeries(series.key)}>{series.name}</button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

    </div>
  );
}

function QuickToggle({ icon, tone, label, value, onChange, statusText, control }: { icon: React.ReactNode; tone: string; label: string; value: boolean; onChange: () => void; statusText?: string; control?: React.ReactNode }) {
  return (
    <div className="quick-toggle">
      <span className={`quick-icon ${tone}`}>{icon}</span>
      <span><strong>{label}</strong>{statusText && <StatusDot status={value ? "success" : "default"}>{statusText}</StatusDot>}</span>
      {control ?? <Switch checked={value} onChange={onChange} />}
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
