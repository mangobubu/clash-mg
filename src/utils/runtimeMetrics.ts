export interface RuntimeMetrics {
  uploadBytesPerSecond: number;
  downloadBytesPerSecond: number;
  memoryBytes: number;
}

export const emptyRuntimeMetrics: RuntimeMetrics = {
  uploadBytesPerSecond: 0,
  downloadBytesPerSecond: 0,
  memoryBytes: 0,
};

export function buildRuntimeStreamUrl(controllerUrl: string, path: "/traffic" | "/memory", secret: string): string {
  const normalizedControllerUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(controllerUrl)
    ? controllerUrl
    : `http://${controllerUrl}`;
  const url = new URL(normalizedControllerUrl);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  if (secret) url.searchParams.set("token", secret);

  return url.toString();
}

export function parseTrafficMetrics(payload: string): Pick<RuntimeMetrics, "uploadBytesPerSecond" | "downloadBytesPerSecond"> | undefined {
  const data = parseRecord(payload);
  if (!data) return undefined;

  return {
    uploadBytesPerSecond: toNonNegativeNumber(data.up),
    downloadBytesPerSecond: toNonNegativeNumber(data.down),
  };
}

export function parseMemoryBytes(payload: string): number | undefined {
  const data = parseRecord(payload);
  if (!data || typeof data.inuse !== "number" || !Number.isFinite(data.inuse)) return undefined;
  return Math.max(0, data.inuse);
}

export function formatMemoryMegabytes(memoryBytes: number): string {
  const megabytes = Math.max(0, Number.isFinite(memoryBytes) ? memoryBytes : 0) / 1024 / 1024;
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

export function formatRuntimeByteRate(bytesPerSecond: number): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${Math.round(value)} ${units[unitIndex]}`;
  if (value >= 100) return `${value.toFixed(0)} ${units[unitIndex]}`;
  if (value >= 10) return `${value.toFixed(1)} ${units[unitIndex]}`;
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function parseRecord(payload: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
