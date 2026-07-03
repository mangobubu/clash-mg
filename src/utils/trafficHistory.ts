import type { Connection, ProxyGroup, TrafficPoint } from "../types";

export type TrafficRange = "24h" | "7d" | "30d";

export interface TrafficChartPoint extends TrafficPoint {
  bucket: number;
  sampledAt: number;
}

export interface TrafficChartData {
  data: TrafficChartPoint[];
  domain: [number, number];
  ticks: number[];
  tickLabels: string[];
}

const metadataKeys = new Set(["time", "sampledAt", "bucket"]);
const trafficHistoryBucketMs = 5 * 60 * 1000;
const trafficHistoryRetentionMs = 30 * 24 * 60 * 60 * 1000;
const trafficSizeUnits: Record<string, number> = {
  B: 1 / 1024 / 1024,
  KB: 1 / 1024,
  MB: 1,
  GB: 1024,
  TB: 1024 * 1024,
};

interface TrafficHistorySampleInput {
  connections: Connection[];
  groups: ProxyGroup[];
  downloadTotal: string;
  uploadTotal: string;
}

export function buildTrafficChartData(
  history: TrafficPoint[],
  range: TrafficRange,
  seriesKeys: string[],
  now = Date.now(),
): TrafficChartData {
  const todayStart = startOfDay(now);
  const isHourly = range === "24h";
  const bucketCount = isHourly ? 24 : range === "7d" ? 7 : 30;
  const bucketStarts = isHourly
    ? Array.from({ length: bucketCount }, (_, hour) => withHour(todayStart, hour))
    : Array.from({ length: bucketCount }, (_, index) => addDays(todayStart, index - bucketCount + 1));
  const rangeStart = bucketStarts[0];
  const rangeEnd = addDays(todayStart, 1);
  const dayBuckets = new Map(bucketStarts.map((timestamp, index) => [dateKey(timestamp), index]));
  const latestByBucket = new Map<number, { point: TrafficPoint; sampledAt: number }>();
  const valueKeys = collectValueKeys(history, seriesKeys);

  for (const point of history) {
    const sampledAt = resolveSampledAt(point, todayStart);
    if (sampledAt === undefined || sampledAt < rangeStart || sampledAt >= rangeEnd) continue;

    const bucket = isHourly ? new Date(sampledAt).getHours() : dayBuckets.get(dateKey(sampledAt));
    if (bucket === undefined || bucket < 0 || bucket >= bucketCount) continue;

    const current = latestByBucket.get(bucket);
    if (!current || sampledAt >= current.sampledAt) {
      latestByBucket.set(bucket, { point, sampledAt });
    }
  }

  const visibleBucketCount = isHourly ? new Date(now).getHours() + 1 : bucketCount;
  const data = Array.from({ length: visibleBucketCount }, (_, bucket) => {
    const latest = latestByBucket.get(bucket);
    const point: TrafficChartPoint = {
      bucket,
      sampledAt: bucketStarts[bucket],
      time: isHourly ? `${pad(bucket)}:00` : fullDate(bucketStarts[bucket]),
      download: 0,
      upload: 0,
    };

    for (const key of valueKeys) {
      point[key] = latest && typeof latest.point[key] === "number" ? latest.point[key] : 0;
    }

    return point;
  });
  const ticks = Array.from({ length: isHourly ? 25 : bucketCount }, (_, index) => index);
  const tickLabels = isHourly
    ? ticks.map(String)
    : bucketStarts.map(shortDate);

  return {
    data,
    domain: isHourly ? [0, 24] : [0, bucketCount - 1],
    ticks,
    tickLabels,
  };
}

export function appendTrafficHistorySample(
  history: TrafficPoint[],
  { connections, groups, downloadTotal, uploadTotal }: TrafficHistorySampleInput,
  now = Date.now(),
): TrafficPoint[] {
  const point: TrafficPoint = {
    time: timeLabel(now),
    sampledAt: now,
    download: parseTrafficSizeToMegabytes(downloadTotal),
    upload: parseTrafficSizeToMegabytes(uploadTotal),
  };

  for (const group of groups.filter((item) => item.origin === "managed")) {
    point[`proxyGroupTraffic_${group.id}`] = connections
      .filter((connection) => connection.policy === group.name)
      .length;
  }

  const retained = history.filter((item) =>
    typeof item.sampledAt !== "number"
    || item.sampledAt === 0
    || item.sampledAt >= now - trafficHistoryRetentionMs);
  const last = retained.at(-1);

  if (
    last
    && typeof last.sampledAt === "number"
    && last.sampledAt > 0
    && Math.floor(last.sampledAt / trafficHistoryBucketMs) === Math.floor(now / trafficHistoryBucketMs)
  ) {
    return [...retained.slice(0, -1), point];
  }

  return [...retained, point];
}

export function parseTrafficSizeToMegabytes(value: string): number {
  const match = /^([\d.]+)\s*(B|KB|MB|GB|TB)$/i.exec(value.trim());
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;

  return amount * trafficSizeUnits[match[2].toUpperCase()];
}

function collectValueKeys(history: TrafficPoint[], seriesKeys: string[]) {
  const keys = new Set(["download", "upload", ...seriesKeys]);
  for (const point of history) {
    for (const [key, value] of Object.entries(point)) {
      if (!metadataKeys.has(key) && typeof value === "number") keys.add(key);
    }
  }
  return keys;
}

function resolveSampledAt(point: TrafficPoint, todayStart: number) {
  if (typeof point.sampledAt === "number" && Number.isFinite(point.sampledAt) && point.sampledAt > 0) {
    return point.sampledAt;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(point.time);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  const date = new Date(todayStart);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(timestamp: number, days: number) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function withHour(timestamp: number, hour: number) {
  const date = new Date(timestamp);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function dateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function shortDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${shortDate(timestamp)}`;
}

function timeLabel(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
