import { CloseCircleOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Descriptions, Empty, Flex, Tag, Typography, message } from "antd";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { PageHeader, Panel, StatusDot } from "../components/Common";
import { useAppStore } from "../store/useAppStore";
import { isTauriRuntime } from "../utils/tauri";

const { Text, Title } = Typography;

async function closeCurrentDetailWindow() {
  if (await isTauriRuntime()) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
    return;
  }

  window.close();
}

export function ConnectionDetailWindowPage() {
  const { id } = useParams();
  const { connections, closeConnections } = useAppStore();
  const connection = useMemo(() => connections.find((item) => item.id === id), [connections, id]);

  const closeWindow = () => {
    void closeCurrentDetailWindow().catch(() => {
      message.error("关闭窗口失败");
    });
  };

  const terminateConnection = () => {
    if (!connection) return;
    closeConnections([connection.id]);
    message.success("连接已终止");
  };

  if (!connection) {
    return (
      <div className="connection-detail-window">
        <div className="connection-detail-empty">
          <Empty description="未找到连接记录" />
          <Button icon={<CloseOutlined />} onClick={closeWindow}>关闭窗口</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="connection-detail-window">
      <PageHeader
        title="连接详情"
        description={`${connection.target} · ${connection.protocol}`}
        actions={<Button icon={<CloseOutlined />} onClick={closeWindow}>关闭窗口</Button>}
      />

      <Panel className="connection-detail-panel">
        <div className="connection-detail-summary">
          <span className="app-process-icon">{connection.icon}</span>
          <div>
            <Flex gap={10} align="center" wrap="wrap">
              <Title level={3}>{connection.app}</Title>
              <StatusDot status={connection.status === "活跃" ? "success" : "default"}>{connection.status}</StatusDot>
            </Flex>
            <Text type="secondary">{connection.process}</Text>
          </div>
        </div>

        <Descriptions
          bordered
          column={1}
          items={[
            { key: "target", label: "目标地址", children: connection.target },
            { key: "ip", label: "目标 IP", children: connection.ip },
            { key: "protocol", label: "协议", children: connection.protocol },
            { key: "traffic", label: "流量", children: `上传 ${connection.upload} / 下载 ${connection.download}` },
            { key: "duration", label: "持续时间", children: connection.duration },
            { key: "rule", label: "命中规则", children: <Tag color={connection.rule === "广告拦截" ? "red" : connection.rule === "媒体分流" ? "green" : connection.rule === "ChatGPT" ? "purple" : "blue"}>{connection.rule}</Tag> },
            { key: "policy", label: "命中策略组", children: connection.policy },
            { key: "node", label: "最终节点", children: connection.node },
            { key: "chain", label: "完整代理链", children: connection.chain.join(" → ") },
            { key: "status", label: "状态", children: <StatusDot status={connection.status === "活跃" ? "success" : "default"}>{connection.status}</StatusDot> },
          ]}
        />

        <Flex className="connection-detail-footer" justify="flex-end" gap={10} wrap="wrap">
          <Button icon={<CloseOutlined />} onClick={closeWindow}>关闭窗口</Button>
          {connection.status === "活跃" && (
            <Button danger icon={<CloseCircleOutlined />} onClick={terminateConnection}>
              终止连接
            </Button>
          )}
        </Flex>
      </Panel>
    </div>
  );
}
