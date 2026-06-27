import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownloadOutlined, LoadingOutlined, ReloadOutlined } from "@ant-design/icons";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button, Flex, Modal, Progress, Typography } from "antd";
import { downloadMihomoCore, getMihomoCoreStatus, startMihomoCore } from "../backend/api";
import { useAppStore } from "../store/useAppStore";
import type { MihomoCoreDownloadProgress } from "../types";

const downloadEventName = "mihomo-core-download-progress";

const initialProgress: MihomoCoreDownloadProgress = {
  status: "resolving",
  downloadedBytes: 0,
  speedBytesPerSecond: 0,
  percent: 0,
};

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${bytes} B`;
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
};

const statusText: Record<MihomoCoreDownloadProgress["status"] | "checking" | "starting", string> = {
  checking: "正在检查 Mihomo 内核",
  resolving: "正在解析下载源",
  downloading: "正在下载 Mihomo 内核",
  extracting: "正在安装 Mihomo 内核",
  completed: "下载完成",
  starting: "正在启动 Mihomo",
  failed: "处理失败",
};

export function MihomoCoreBootstrap() {
  const hydrated = useAppStore((state) => state.hydrated);
  const backendAvailable = useAppStore((state) => state.backendAvailable);
  const settings = useAppStore((state) => state.settings);
  const refreshRuntimeData = useAppStore((state) => state.refreshRuntimeData);
  const initializedRef = useRef(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<MihomoCoreDownloadProgress["status"] | "checking" | "starting">("checking");
  const [progress, setProgress] = useState<MihomoCoreDownloadProgress>(initialProgress);
  const [error, setError] = useState<string | null>(null);

  const cleanupListener = useCallback(() => {
    if (!unlistenRef.current) return;
    unlistenRef.current();
    unlistenRef.current = null;
  }, []);

  const startCoreAndRefresh = useCallback(async () => {
    setPhase("starting");
    const result = await startMihomoCore(settings);
    if (!result.controllerReady) {
      setOpen(true);
      setPhase("failed");
      setError(result.message);
      return;
    }

    await refreshRuntimeData();
    setOpen(false);
  }, [refreshRuntimeData, settings]);

  const runDownload = useCallback(async () => {
    cleanupListener();
    setOpen(true);
    setBusy(true);
    setError(null);
    setPhase("resolving");
    setProgress(initialProgress);

    unlistenRef.current = await listen<MihomoCoreDownloadProgress>(downloadEventName, (event) => {
      setProgress(event.payload);
      setPhase(event.payload.status);
      if (event.payload.status === "failed" && event.payload.message) {
        setError(event.payload.message);
      }
    });

    try {
      await downloadMihomoCore();
      await startCoreAndRefresh();
    } catch (downloadError) {
      setOpen(true);
      setPhase("failed");
      setError(String(downloadError));
    } finally {
      setBusy(false);
      cleanupListener();
    }
  }, [cleanupListener, startCoreAndRefresh]);

  useEffect(() => {
    if (!hydrated || !backendAvailable || initializedRef.current) return;
    initializedRef.current = true;

    const bootstrap = async () => {
      try {
        setPhase("checking");
        const status = await getMihomoCoreStatus();

        if (!status.exists) {
          await runDownload();
          return;
        }

        await startCoreAndRefresh();
      } catch (bootstrapError) {
        setOpen(true);
        setPhase("failed");
        setError(String(bootstrapError));
      }
    };

    void bootstrap();

    return () => {
      cleanupListener();
    };
  }, [backendAvailable, cleanupListener, hydrated, runDownload, startCoreAndRefresh]);

  const percent = Math.round(progress.percent || 0);
  const title = phase === "failed" ? "Mihomo 内核未就绪" : "准备 Mihomo 内核";

  return (
    <Modal
      open={open}
      title={title}
      centered
      closable={false}
      maskClosable={false}
      width={520}
      footer={phase === "failed" ? <Button type="primary" icon={<ReloadOutlined />} loading={busy} onClick={runDownload}>重试下载</Button> : null}
    >
      <div className="core-download-modal">
        <div className="core-download-icon">
          {phase === "failed" ? <CloudDownloadOutlined /> : <LoadingOutlined spin />}
        </div>
        <Flex vertical gap={8} className="core-download-content">
          <Typography.Text strong>{statusText[phase]}</Typography.Text>
          <Typography.Text type="secondary">{error ?? progress.message ?? "正在为应用准备本地 Mihomo 运行环境"}</Typography.Text>
          <Progress
            percent={percent}
            status={phase === "failed" ? "exception" : phase === "completed" ? "success" : "active"}
            showInfo
          />
          <div className="core-download-stats">
            <span>{formatBytes(progress.downloadedBytes)} / {progress.totalBytes ? formatBytes(progress.totalBytes) : "未知大小"}</span>
            <span>{formatBytes(progress.speedBytesPerSecond)}/s</span>
          </div>
        </Flex>
      </div>
    </Modal>
  );
}
