import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Button, Modal, Popover, Switch, Typography, message } from "antd";
import { getTunServiceStatus, installTunService, uninstallTunService } from "../backend/api";
import { useAppStore } from "../store/useAppStore";
import type { TunServiceStatus } from "../types";

const unavailableStatus: TunServiceStatus = {
  installed: false,
  running: false,
  versionCompatible: false,
};

export function isTunServiceAvailable(status: TunServiceStatus) {
  return status.installed && status.versionCompatible && !status.message;
}

export function isTunSwitchLoading(checking: boolean, switching: boolean) {
  return checking || switching;
}

interface TunServiceContextValue {
  status: TunServiceStatus;
  checking: boolean;
  busy: boolean;
  switching: boolean;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  uninstall: () => Promise<void>;
  toggleTun: (enabled: boolean) => Promise<void>;
}

const TunServiceContext = createContext<TunServiceContextValue | null>(null);

export function TunServiceProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useAppStore((state) => state.hydrated);
  const backendAvailable = useAppStore((state) => state.backendAvailable);
  const tunEnabled = useAppStore((state) => Boolean(state.settings.tunMode));
  const updateSetting = useAppStore((state) => state.updateSetting);
  const applyTunMode = useAppStore((state) => state.applyTunMode);
  const [status, setStatus] = useState<TunServiceStatus>(unavailableStatus);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    if (!backendAvailable) {
      setStatus(unavailableStatus);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      setStatus(await getTunServiceStatus());
    } catch (error) {
      setStatus({ ...unavailableStatus, message: String(error) });
    } finally {
      setChecking(false);
    }
  }, [backendAvailable]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  useEffect(() => {
    if (checking || !tunEnabled) return;
    if (!status.installed || !status.versionCompatible) updateSetting("tunMode", false);
  }, [checking, status.installed, status.versionCompatible, tunEnabled, updateSetting]);

  const install = useCallback(async () => {
    setBusy(true);
    try {
      const next = await installTunService();
      setStatus(next);
      message.success("TUN 系统服务安装成功");
    } catch (error) {
      message.error({ content: `安装 TUN 系统服务失败：${String(error)}`, duration: 6 });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const uninstall = useCallback(async () => {
    setBusy(true);
    try {
      const next = await uninstallTunService();
      setStatus(next);
      message.success("TUN 系统服务已删除");
    } catch (error) {
      message.error({ content: `删除 TUN 系统服务失败：${String(error)}`, duration: 6 });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const toggleTun = useCallback(async (enabled: boolean) => {
    if (switching) return;
    setSwitching(true);
    try {
      await applyTunMode(enabled);
      message.success(`TUN 模式已${enabled ? "开启" : "关闭"}`);
    } catch (error) {
      message.error({
        content: `TUN ${enabled ? "开启" : "关闭"}失败：${String(error)}`,
        duration: 8,
      });
    } finally {
      setSwitching(false);
    }
  }, [applyTunMode, switching]);

  const value = useMemo(
    () => ({ status, checking, busy, switching, refresh, install, uninstall, toggleTun }),
    [busy, checking, install, refresh, status, switching, toggleTun, uninstall],
  );

  return <TunServiceContext.Provider value={value}>{children}</TunServiceContext.Provider>;
}

export function useTunService() {
  const value = useContext(TunServiceContext);
  if (!value) throw new Error("useTunService 必须在 TunServiceProvider 内使用");
  return value;
}

export function TunServiceControl({
  checked,
  compact = false,
}: {
  checked: boolean;
  compact?: boolean;
}) {
  const { status, checking, busy, switching, install, uninstall, toggleTun } = useTunService();
  const available = isTunServiceAvailable(status);
  const serviceActionLabel = status.installed ? "删除 TUN 系统服务" : "安装 TUN 系统服务";

  const handleServiceAction = () => {
    if (!status.installed) {
      void install();
      return;
    }
    Modal.confirm({
      title: "删除 TUN 系统服务？",
      content: checked
        ? "当前 TUN 正在运行。删除前会先关闭 TUN 并恢复普通 Mihomo 进程。"
        : "删除后 TUN 开关将保持禁用，重新安装服务后才能再次开启。",
      okText: "删除服务",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: uninstall,
    });
  };

  const explanation = (
    <div className="tun-service-popover">
      <Typography.Paragraph>
        TUN 需要系统级网络权限。安装服务时会请求一次管理员授权，之后日常开启和关闭 TUN 不再重复提权。
      </Typography.Paragraph>
      <Typography.Paragraph>
        服务仅接受状态查询、启动 TUN 和停止 TUN，且只运行安装到系统保护目录中的 Mihomo。
      </Typography.Paragraph>
      <Typography.Text type="secondary">
        {status.installed
          ? status.message ?? `服务已安装${status.serviceVersion ? ` · v${status.serviceVersion}` : ""}`
          : "服务尚未安装，TUN 开关当前不可用。删除或修复服务时系统可能再次请求管理员权限。"}
      </Typography.Text>
    </div>
  );

  return (
    <div className={`tun-service-control${compact ? " compact" : ""}`}>
      <Switch
        checked={available && checked}
        disabled={checking || busy || switching || !available}
        loading={isTunSwitchLoading(checking, switching)}
        onChange={(enabled) => void toggleTun(enabled)}
        aria-label="TUN 模式"
      />
      <Button
        type="text"
        danger={status.installed}
        disabled={checking || busy || switching}
        icon={busy ? <LoadingOutlined spin /> : status.installed ? <DeleteOutlined /> : <ToolOutlined />}
        onClick={handleServiceAction}
        aria-label={serviceActionLabel}
        title={serviceActionLabel}
      />
      <Popover title="TUN 系统服务说明" content={explanation} placement="topRight" trigger={["hover", "focus"]}>
        <Button type="text" icon={<InfoCircleOutlined />} aria-label="TUN 系统服务说明" />
      </Popover>
    </div>
  );
}
