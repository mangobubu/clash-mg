import type { AppSettings } from "../types";

export function shouldBootstrapMihomoCore(settings: AppSettings) {
  return settings.coreStartTiming !== "手动启动" || settings.systemProxy === true;
}
