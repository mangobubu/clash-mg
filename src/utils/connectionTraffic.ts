import type { Connection } from "../types";

export interface ConnectionRate {
  upload: number;
  download: number;
}

export interface ConnectionTrafficSample {
  sampledAt: number;
  totals: Record<string, ConnectionRate>;
}

export function calculateConnectionRates(
  connections: Connection[],
  sampledAt: number,
  previous?: ConnectionTrafficSample,
): { rates: Record<string, ConnectionRate>; sample: ConnectionTrafficSample } {
  const elapsedSeconds = previous ? (sampledAt - previous.sampledAt) / 1000 : 0;
  const rates: Record<string, ConnectionRate> = {};
  const totals: Record<string, ConnectionRate> = {};

  for (const connection of connections) {
    const current = {
      upload: connection.uploadBytes,
      download: connection.downloadBytes,
    };
    const prior = previous?.totals[connection.id];
    totals[connection.id] = current;
    rates[connection.id] = {
      upload: byteDeltaPerSecond(current.upload, prior?.upload, elapsedSeconds),
      download: byteDeltaPerSecond(current.download, prior?.download, elapsedSeconds),
    };
  }

  return { rates, sample: { sampledAt, totals } };
}

export function formatByteRate(bytesPerSecond: number): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
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

export function durationToSeconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function byteDeltaPerSecond(current: number, previous: number | undefined, elapsedSeconds: number): number {
  if (previous === undefined || elapsedSeconds <= 0 || current < previous) return 0;
  return (current - previous) / elapsedSeconds;
}
