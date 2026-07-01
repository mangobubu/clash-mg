import { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Typography } from "antd";
import { startMihomoCore } from "../backend/api";
import { useAppStore } from "../store/useAppStore";
import { getEffectiveTunSettings, useTunService } from "./TunServiceControl";

export function MihomoCoreBootstrap() {
  const hydrated = useAppStore((state) => state.hydrated);
  const backendAvailable = useAppStore((state) => state.backendAvailable);
  const settings = useAppStore((state) => state.settings);
  const refreshRuntimeData = useAppStore((state) => state.refreshRuntimeData);
  const testAutoProxyGroups = useAppStore((state) => state.testAutoProxyGroups);
  const { status: tunServiceStatus, checking: checkingTunService } = useTunService();
  const initializedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCoreAndRefresh = useCallback(async () => {
    const effectiveSettings = getEffectiveTunSettings(settings, tunServiceStatus);

    const result = await startMihomoCore(effectiveSettings);
    if (!result.controllerReady) throw new Error(result.message);

    await refreshRuntimeData();
    await testAutoProxyGroups();
  }, [refreshRuntimeData, settings, testAutoProxyGroups, tunServiceStatus]);

  const prepareCore = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      await startCoreAndRefresh();
      setOpen(false);
    } catch (prepareError) {
      setError(String(prepareError));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }, [startCoreAndRefresh]);

  useEffect(() => {
    if (!hydrated || !backendAvailable || checkingTunService || initializedRef.current) return;
    initializedRef.current = true;
    void prepareCore();
  }, [backendAvailable, checkingTunService, hydrated, prepareCore]);

  return (
    <Modal
      open={open}
      title="Mihomo 内核启动失败"
      centered
      closable={!busy}
      keyboard={!busy}
      maskClosable={!busy}
      onCancel={() => setOpen(false)}
      width={520}
      footer={[
        <Button key="close" disabled={busy} onClick={() => setOpen(false)}>关闭</Button>,
        <Button key="retry" type="primary" icon={<ReloadOutlined />} loading={busy} onClick={prepareCore}>重试启动</Button>,
      ]}
    >
      <div className="core-bootstrap-error">
        <div className="core-bootstrap-icon"><WarningOutlined /></div>
        <Flex vertical gap={8} className="core-bootstrap-content">
          <Typography.Text strong>随应用提供的 Mihomo 未能正常启动</Typography.Text>
          <Typography.Text type="secondary">{error}</Typography.Text>
        </Flex>
      </div>
    </Modal>
  );
}
