import { useEffect, useRef } from "react";
import { Modal, Typography } from "antd";
import { checkAppUpdate } from "../backend/api";
import { useAppStore } from "../store/useAppStore";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function AppUpdateChecker() {
  const hydrated = useAppStore((state) => state.hydrated);
  const enabled = useAppStore((state) => Boolean(state.settings.autoCheckUpdate));
  const promptedVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!hydrated || !enabled) return;
    let active = true;

    const check = async () => {
      try {
        const update = await checkAppUpdate();
        if (!active || !update.updateAvailable || promptedVersion.current === update.latestVersion) return;
        promptedVersion.current = update.latestVersion;
        Modal.confirm({
          title: `发现新版本 v${update.latestVersion}`,
          content: <Typography.Paragraph ellipsis={{ rows: 5, expandable: true }}>{update.releaseNotes || `当前版本为 v${update.currentVersion}。`}</Typography.Paragraph>,
          okText: "查看发布页面",
          cancelText: "稍后提醒",
          onOk: () => { window.open(update.releaseUrl, "_blank", "noopener,noreferrer"); },
        });
      } catch (error) {
        console.warn("自动检查更新失败", error);
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, hydrated]);

  return null;
}
