import { useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  PlusOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import {
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Menu,
  Modal,
  Segmented,
  Select,
  Switch,
  Table,
  Typography,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader, Panel, SaveSuccess, SummaryFooter } from "../../components/Common";
import { useAppStore } from "../../store/useAppStore";
import type { OverrideItem, SettingValue, ThemeMode } from "../../types";
import { settingDefinitions } from "./settingsConfig";
import type { SettingField, SettingSection } from "./settingsConfig";

const { Text, Title } = Typography;

const sectionMenu = [
  { key: "general", icon: <SettingOutlined />, label: "常规" },
  { key: "core", icon: <SafetyCertificateOutlined />, label: "核心" },
  { key: "network", icon: <WifiOutlined />, label: "网络" },
  { key: "dns", icon: <GlobalOutlined />, label: "DNS" },
  { key: "override", icon: <CodeOutlined />, label: "覆写" },
  { key: "interface", icon: <DesktopOutlined />, label: "界面" },
  { key: "log", icon: <FileTextOutlined />, label: "日志" },
];

const dnsSections: SettingSection[] = [
  { title: "基础 DNS", fields: [
    { key: "dnsEnabled", label: "启用 DNS", control: "switch" },
    { key: "enhancedMode", label: "增强模式", control: "select", options: ["Fake-IP", "Redir-Host", "关闭"] },
    { key: "dnsIpv6", label: "IPv6 解析", control: "switch" },
    { key: "overrideSystemDns", label: "覆写系统 DNS", control: "switch" },
    { key: "dnsListen", label: "监听地址", control: "input" },
    { key: "useHosts", label: "使用 hosts", control: "switch" },
  ] },
  { title: "上游 DNS 服务器", fields: [
    { key: "defaultDns", label: "默认 DNS", control: "tags", span: 2 },
    { key: "proxyDns", label: "代理 DNS", control: "tags", span: 2 },
    { key: "directDns", label: "直连 DNS", control: "tags", span: 2 },
    { key: "dnsPolicy", label: "DNS 策略", control: "select", options: ["优先使用代理 DNS", "并发查询", "遵循规则"] },
  ] },
  { title: "Fallback 与过滤", fields: [
    { key: "fallbackDns", label: "Fallback DNS", control: "tags", span: 2 },
    { key: "domainWhitelist", label: "域名白名单", control: "input" },
    { key: "geoIpFilter", label: "GeoIP 过滤", control: "switch" },
    { key: "proxyOnlyFallback", label: "仅代理域名使用 fallback", control: "switch" },
    { key: "geoSiteFilter", label: "GeoSite 过滤", control: "switch" },
    { key: "cidrWhitelist", label: "IP CIDR 白名单", control: "input", span: 2 },
  ] },
  { title: "Fake-IP 与高级选项", fields: [
    { key: "fakeIpRange", label: "Fake-IP 范围", control: "input" },
    { key: "dnsCache", label: "DNS 缓存", control: "switch" },
    { key: "fakeIpFilter", label: "Fake-IP 过滤", control: "textarea" },
    { key: "ecs", label: "ECS / EDNS Client Subnet", control: "switch" },
    { key: "followRules", label: "遵循规则", control: "switch" },
    { key: "nameServerPolicy", label: "nameserver-policy", control: "textarea", span: 2 },
  ] },
];

type OverrideScope = "domain" | "request" | "response";

export function SettingsPage() {
  const navigate = useNavigate();
  const { section = "general" } = useParams<{ section: string }>();
  const activeSection = sectionMenu.some((item) => item.key === section) ? section : "general";
  const [lastSaved, setLastSaved] = useState("刚刚");
  const { settings, updateSetting, resetSettings, themeMode, setThemeMode, accent, setAccent } = useAppStore();
  const definition = settingDefinitions[activeSection];

  const save = () => {
    setLastSaved(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    message.success("设置已保存并应用");
  };

  const reset = () => Modal.confirm({
    title: "重置全部设置？", content: "将恢复原型默认配置，页面中的修改会被覆盖。", okText: "重置", cancelText: "取消",
    onOk: () => { resetSettings(); message.success("已恢复默认设置"); },
  });

  const title = activeSection === "dns" ? "DNS 设置" : activeSection === "override" ? "覆写设置" : definition.title;
  const description = activeSection === "dns" ? "管理 DNS 服务器、增强模式与解析规则。" : activeSection === "override" ? "管理域名、请求头与响应头覆写规则。" : definition.description;

  return (
    <div className="page-stack settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar panel">
          <Title level={2}>设置</Title>
          <Text type="secondary">管理核心、网络、DNS 与界面行为设置。</Text>
          <Menu selectedKeys={[activeSection]} items={sectionMenu} onClick={({ key }) => navigate(`/settings/${key}`)} />
        </aside>
        <div className="settings-content">
          <PageHeader title={title} description={description} actions={<><Button icon={<RedoOutlined />} onClick={reset}>重置默认</Button><Button type="primary" icon={<SaveOutlined />} onClick={save}>保存设置</Button></>} />
          {activeSection === "override" ? <OverrideSettings /> : (
            <>
              {(activeSection === "dns" ? dnsSections : definition.sections).map((settingSection) => (
                <Panel key={settingSection.title} title={<Title level={3}>{settingSection.title}</Title>} className="settings-section">
                  {settingSection.description && <Text type="secondary">{settingSection.description}</Text>}
                  <div className="settings-fields">
                    {settingSection.fields.map((field) => (
                      <SettingFieldControl key={field.key} field={field} value={field.key === "accent" ? accent : settings[field.key]} onChange={(value) => field.key === "accent" ? setAccent(String(value)) : updateSetting(field.key, value)} themeMode={themeMode} setThemeMode={setThemeMode} />
                    ))}
                  </div>
                </Panel>
              ))}
            </>
          )}
          <SettingsFooter section={activeSection} lastSaved={lastSaved} />
        </div>
      </div>
    </div>
  );
}

function SettingFieldControl({ field, value, onChange, themeMode, setThemeMode }: { field: SettingField; value: SettingValue | undefined; onChange: (value: SettingValue) => void; themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void }) {
  let control: React.ReactNode;
  if (field.control === "switch") control = <Switch checked={Boolean(value)} onChange={onChange} />;
  else if (field.control === "select") control = <Select value={String(value ?? "")} onChange={onChange} options={field.options?.map((option) => ({ label: option, value: option }))} />;
  else if (field.control === "number") control = <InputNumber value={Number(value ?? 0)} min={field.min} max={field.max} onChange={(next) => onChange(next ?? 0)} />;
  else if (field.control === "password") control = <Input.Password value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  else if (field.control === "textarea") control = <Input.TextArea value={String(value ?? "")} rows={3} onChange={(event) => onChange(event.target.value)} />;
  else if (field.control === "tags") control = <Select mode="tags" value={Array.isArray(value) ? value : []} onChange={onChange} tokenSeparators={[",", " "]} />;
  else if (field.control === "theme") control = <Segmented block value={themeMode} options={[{ label: "浅色", value: "light" }, { label: "深色", value: "dark" }, { label: "跟随系统", value: "system" }]} onChange={(next) => { setThemeMode(next as ThemeMode); onChange(next === "light" ? "浅色" : next === "dark" ? "深色" : "跟随系统"); }} />;
  else if (field.control === "accent") control = <div className="accent-picker">{["#12b8c4", "#18b368", "#9254de", "#597ef7", "#36a8e8", "#fa8c16", "#eb5a67", "#b8c0cc"].map((color) => <button key={color} style={{ background: color }} className={value === color ? "selected" : ""} onClick={() => onChange(color)} aria-label={`主题色 ${color}`} />)}</div>;
  else control = <Input value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;

  return (
    <div className={`setting-field${field.span === 2 ? " span-two" : ""}${field.control === "switch" ? " is-switch" : ""}`}>
      <div className="setting-label"><strong>{field.label}</strong>{field.description && <Text type="secondary">{field.description}</Text>}</div>
      <div className="setting-control">{control}</div>
    </div>
  );
}

function SettingsFooter({ section, lastSaved }: { section: string; lastSaved: string }) {
  const items = useMemo(() => {
    if (section === "dns") return [{ icon: <SafetyCertificateOutlined />, label: "当前模式", value: "Fake-IP" }, { icon: <GlobalOutlined />, label: "当前监听地址", value: "0.0.0.0:1053" }, { icon: <FolderOpenOutlined />, label: "默认 DNS 数量", value: "4" }, { icon: <ClockCircleOutlined />, label: "最后保存", value: lastSaved }];
    if (section === "interface") return [{ icon: <DesktopOutlined />, label: "当前主题", value: "浅色 · 青绿色" }, { icon: <GlobalOutlined />, label: "当前语言", value: "简体中文" }, { icon: <SettingOutlined />, label: "布局密度", value: "舒适" }, { icon: <ClockCircleOutlined />, label: "最后保存", value: lastSaved }];
    if (section === "log") return [{ icon: <FileTextOutlined />, label: "当前级别", value: "Info" }, { icon: <CheckCircleOutlined />, label: "文件写入", value: "已启用" }, { icon: <FolderOpenOutlined />, label: "日志路径", value: "~/logs/clash-mg" }, { icon: <ClockCircleOutlined />, label: "最后保存", value: lastSaved }];
    return [{ icon: <CheckCircleOutlined />, label: "状态", value: <SaveSuccess /> }, { icon: <SafetyCertificateOutlined />, label: "当前核心", value: "Clash Meta" }, { icon: <FolderOpenOutlined />, label: "配置文件", value: "default.yaml" }, { icon: <ClockCircleOutlined />, label: "最后保存", value: lastSaved }];
  }, [lastSaved, section]);
  return <SummaryFooter items={items} />;
}

function OverrideSettings() {
  const { domainOverrides, requestOverrides, responseOverrides, addOverride, updateOverride, deleteOverride } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [scope, setScope] = useState<OverrideScope>("domain");
  const [editing, setEditing] = useState<OverrideItem | null>(null);
  const [form] = Form.useForm<OverrideItem>();

  const openModal = (nextScope: OverrideScope, item?: OverrideItem) => {
    setScope(nextScope);
    setEditing(item ?? null);
    form.setFieldsValue(item ?? { id: "", matchType: nextScope === "domain" ? "域名" : "域名通配符", match: "", operation: "设置", field: nextScope === "domain" ? "目标值" : nextScope === "request" ? "User-Agent" : "Cache-Control", value: "", strategy: nextScope === "domain" ? "覆盖" : nextScope === "request" ? "请求头" : "响应头", enabled: true });
    setModalOpen(true);
  };

  const saveOverride = async () => {
    const values = await form.validateFields();
    const item = { ...values, id: editing?.id ?? crypto.randomUUID() };
    if (editing) updateOverride(scope, item); else addOverride(scope, item);
    setModalOpen(false);
    message.success(editing ? "覆写规则已保存" : "覆写规则已添加");
  };

  const renderSection = (title: string, currentScope: OverrideScope, data: OverrideItem[]) => {
    const columns: TableColumnsType<OverrideItem> = [
      { title: currentScope === "domain" ? "域名" : "匹配类型", dataIndex: currentScope === "domain" ? "match" : "matchType", width: 180 },
      ...(currentScope === "domain" ? [{ title: "类型", dataIndex: "operation", width: 120 }] : [{ title: "匹配内容", dataIndex: "match", width: 230 }, { title: "操作", dataIndex: "operation", width: 90 }]),
      { title: currentScope === "domain" ? "目标值" : currentScope === "request" ? "请求头" : "响应头", dataIndex: currentScope === "domain" ? "value" : "field", ellipsis: true },
      ...(currentScope === "domain" ? [{ title: "策略", dataIndex: "strategy", width: 170 }] : [{ title: "值", dataIndex: "value", ellipsis: true }]),
      { title: "启用", dataIndex: "enabled", width: 78, render: (enabled: boolean, record: OverrideItem) => <Switch checked={enabled} onChange={(next) => updateOverride(currentScope, { ...record, enabled: next })} /> },
      { title: "操作", key: "actions", width: 95, render: (_: unknown, record: OverrideItem) => <Flex gap={4}><Button type="text" icon={<EditOutlined />} onClick={() => openModal(currentScope, record)} aria-label="编辑覆写" /><Button type="text" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: "删除此覆写规则？", okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => deleteOverride(currentScope, record.id) })} aria-label="删除覆写" /></Flex> },
    ];
    return <Panel key={currentScope} title={<Title level={3}>{title}</Title>} extra={<Button icon={<PlusOutlined />} onClick={() => openModal(currentScope)}>新增</Button>} className="override-section"><Table<OverrideItem> rowKey="id" columns={columns} dataSource={data} pagination={false} scroll={{ x: 800 }} size="small" /></Panel>;
  };

  return (
    <>
      {renderSection("域名覆写", "domain", domainOverrides)}
      {renderSection("请求头覆写", "request", requestOverrides)}
      {renderSection("响应头覆写", "response", responseOverrides)}
      <div className="hint-bar">提示：覆写规则按照列表顺序从上到下匹配，命中后立即生效。</div>
      <Modal open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void saveOverride()} title={editing ? "编辑覆写规则" : "新增覆写规则"} okText="保存" cancelText="取消" width={680} destroyOnHidden>
        <Form<OverrideItem> form={form} layout="vertical">
          <div className="form-grid two-columns">
            <Form.Item label="匹配类型" name="matchType" rules={[{ required: true }]}><Select options={["域名", "域名通配符", "正则表达式"].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item label="匹配内容" name="match" rules={[{ required: true, message: "请输入匹配内容" }]}><Input placeholder="例如：*.example.com" /></Form.Item>
            <Form.Item label="操作" name="operation"><Select options={["设置", "删除", "Hosts", "重定向", "阻止", "策略"].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item label={scope === "domain" ? "目标字段" : scope === "request" ? "请求头" : "响应头"} name="field"><Input /></Form.Item>
            <Form.Item label="值" name="value" rules={[{ required: true, message: "请输入覆写值" }]}><Input /></Form.Item>
            <Form.Item label="策略" name="strategy"><Input /></Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch /></Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
