import type { CSSProperties, ReactNode } from "react";
import { Badge, Button, Flex, Tooltip, Typography, message } from "antd";
import { CheckCircleFilled, CopyOutlined, InfoCircleOutlined } from "@ant-design/icons";

const { Text, Title } = Typography;

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`app-logo${compact ? " is-compact" : ""}`} aria-label="clash-mg">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <strong>clash-mg</strong>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <Title level={2}>{title}</Title>
        <Text type="secondary">{description}</Text>
      </div>
      {actions && <Flex gap={12} wrap="wrap" justify="flex-end">{actions}</Flex>}
    </div>
  );
}

export function Panel({
  title,
  extra,
  children,
  className = "",
  style,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || extra) && (
        <div className="panel-heading">
          <div className="panel-title">{title}</div>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusDot({
  status = "success",
  children,
}: {
  status?: "success" | "warning" | "error" | "default" | "processing";
  children: ReactNode;
}) {
  return <Badge status={status} text={children} />;
}

export function Latency({ value, showBars = true }: { value: number; showBars?: boolean }) {
  if (value <= 0) {
    return <span className="latency latency-untested">未测速</span>;
  }

  const tone = value < 100 ? "good" : value < 180 ? "medium" : "bad";
  return (
    <span className={`latency latency-${tone}`}>
      {value} ms
      {showBars && (
        <span className="signal-bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      )}
    </span>
  );
}

export function HintBar({ children }: { children: ReactNode }) {
  return (
    <div className="hint-bar">
      <InfoCircleOutlined />
      <span>{children}</span>
    </div>
  );
}

export function SummaryFooter({ items }: { items: Array<{ icon: ReactNode; label: string; value: ReactNode }> }) {
  return (
    <div className="summary-footer">
      {items.map((item) => (
        <div className="summary-item" key={item.label}>
          <span className="summary-icon">{item.icon}</span>
          <span><Text type="secondary">{item.label}</Text><strong>{item.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

export function CompactCopy({ text, label = "复制" }: { text: string; label?: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制到剪贴板");
    } catch {
      message.info(`复制内容：${text}`);
    }
  };
  return (
    <Tooltip title={label}>
      <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} aria-label={label} />
    </Tooltip>
  );
}

export function SaveSuccess() {
  return <span className="save-success"><CheckCircleFilled /> 当前配置有效</span>;
}
