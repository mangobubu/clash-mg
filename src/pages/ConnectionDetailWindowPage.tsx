import { CloseCircleOutlined, CloseOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { Button, Descriptions, Empty, Flex, Spin, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader, Panel, StatusDot } from "../components/Common";
import { ProcessIcon } from "../components/ProcessIcon";
import { useAppStore } from "../store/useAppStore";
import type { Connection } from "../types";
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
  const [connectionSnapshot, setConnectionSnapshot] = useState<Connection>();
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const { connections, closeConnections } = useAppStore();
  const connection = useMemo(
    () => connectionSnapshot ?? connections.find((item) => item.id === id),
    [connectionSnapshot, connections, id],
  );

  useEffect(() => {
    let mounted = true;

    if (!id) {
      setSnapshotLoaded(true);
      return;
    }

    void invoke<Connection | null>("get_connection_detail_snapshot", { id })
      .then((snapshot) => {
        if (mounted && snapshot) setConnectionSnapshot(snapshot);
      })
      .catch((error) => console.error("连接详情快照读取失败", error))
      .finally(() => {
        if (mounted) setSnapshotLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const closeWindow = () => {
    void closeCurrentDetailWindow().catch(() => {
      message.error("关闭窗口失败");
    });
  };

  const terminateConnection = async () => {
    if (!connection) return;
    try {
      await closeConnections([connection.id]);
      message.success("连接已终止");
    } catch (error) {
      message.error(`终止连接失败：${String(error)}`);
    }
  };

  if (!connection && !snapshotLoaded) {
    return <div className="route-loading"><Spin size="large" /></div>;
  }

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

  const processDetail = connection.processPath || (connection.process !== connection.app ? connection.process : "");

  return (
    <div className="connection-detail-window">
      <PageHeader
        title="连接详情"
        description={`${connection.target} · ${connection.protocol}`}
        actions={<Button icon={<CloseOutlined />} onClick={closeWindow}>关闭窗口</Button>}
      />

      <Panel className="connection-detail-panel">
        <div className="connection-detail-summary">
          <ProcessIcon app={connection.app} icon={connection.icon} />
          <div>
            <Flex gap={10} align="center" wrap="wrap">
              <Title level={3}>{connection.app}</Title>
              <StatusDot status={connection.status === "活跃" ? "success" : "default"}>{connection.status}</StatusDot>
            </Flex>
            {processDetail && <Text type="secondary">{processDetail}</Text>}
          </div>
        </div>

        <Descriptions
          bordered
          column={1}
          items={[
            { key: "target", label: "目标地址", children: connection.target },
            { key: "ip", label: "目标 IP", children: connection.ip },
            { key: "protocol", label: "协议", children: connection.protocol },
            ...(connection.processPath ? [{ key: "processPath", label: "进程路径", children: connection.processPath }] : []),
            { key: "traffic", label: "流量", children: `上传 ${connection.upload} / 下载 ${connection.download}` },
            { key: "duration", label: "持续时间", children: connection.duration },
            { key: "rule", label: "命中规则", children: <Tag color={connection.rule === "广告拦截" ? "red" : connection.rule === "媒体分流" ? "green" : connection.rule === "ChatGPT" ? "purple" : "blue"}>{connection.rule}</Tag> },
            { key: "policy", label: "命中策略组", children: connection.policy },
            { key: "node", label: "出口节点", children: connection.node },
            ...(connection.entryNode ? [{ key: "entryNode", label: "物理入口", children: connection.entryNode }] : []),
            { key: "chain", label: "完整代理链", children: connection.chain.join(" → ") },
            { key: "status", label: "状态", children: <StatusDot status={connection.status === "活跃" ? "success" : "default"}>{connection.status}</StatusDot> },
          ]}
        />

        <Flex className="connection-detail-footer" justify="flex-end" gap={10} wrap="wrap">
          <Button icon={<CloseOutlined />} onClick={closeWindow}>关闭窗口</Button>
          {connection.status === "活跃" && (
            <Button danger icon={<CloseCircleOutlined />} onClick={() => void terminateConnection()}>
              终止连接
            </Button>
          )}
        </Flex>
      </Panel>
    </div>
  );
}
