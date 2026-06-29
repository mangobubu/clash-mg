import { describe, expect, it } from "vitest";
import type { Connection } from "../types";
import {
  applyConnectionRates,
  calculateConnectionRates,
  compareConnectionRates,
  durationToSeconds,
  formatByteRate,
  type ConnectionTrafficSample,
} from "./connectionTraffic";

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: "connection-1",
  app: "浏览器",
  process: "browser.exe",
  processPath: "C:\\browser.exe",
  icon: "",
  target: "example.com:443",
  ip: "203.0.113.1",
  protocol: "TCP",
  uploadBytes: 4096,
  downloadBytes: 8192,
  upload: "4.00 KB",
  download: "8.00 KB",
  duration: "00:00:10",
  rule: "MATCH",
  policy: "节点选择",
  node: "测试节点",
  entryNode: "",
  chain: ["节点选择", "测试节点"],
  status: "活跃",
  ...overrides,
});

describe("formatByteRate", () => {
  it("使用 B/s 到 TB/s 的二进制单位格式化速率", () => {
    expect(formatByteRate(0)).toBe("0 B/s");
    expect(formatByteRate(1024)).toBe("1.00 KB/s");
    expect(formatByteRate(12 * 1024 ** 2)).toBe("12.0 MB/s");
    expect(formatByteRate(2 * 1024 ** 4)).toBe("2.00 TB/s");
  });
});

describe("calculateConnectionRates", () => {
  it("按真实采样间隔计算每条连接的上传和下载速率", () => {
    const previous: ConnectionTrafficSample = {
      sampledAt: 1000,
      totals: { "connection-1": { upload: 2048, download: 4096 } },
    };

    const result = calculateConnectionRates([connection()], 3000, previous);

    expect(result.rates["connection-1"]).toEqual({ upload: 1024, download: 2048 });
  });

  it("首次采样或累计值回退时返回零速率", () => {
    expect(calculateConnectionRates([connection()], 1000).rates["connection-1"]).toEqual({ upload: 0, download: 0 });
    const previous: ConnectionTrafficSample = {
      sampledAt: 1000,
      totals: { "connection-1": { upload: 8192, download: 16384 } },
    };
    expect(calculateConnectionRates([connection()], 2000, previous).rates["connection-1"]).toEqual({ upload: 0, download: 0 });
  });
});

describe("实时速率排序", () => {
  it("速率更新后使用最新结果重新确定降序首行", () => {
    const connections = [
      connection({ id: "connection-1" }),
      connection({ id: "connection-2" }),
    ];
    const initialRows = applyConnectionRates(connections, {
      "connection-1": { upload: 100, download: 100 },
      "connection-2": { upload: 200, download: 200 },
    });
    const updatedRows = applyConnectionRates(connections, {
      "connection-1": { upload: 500, download: 500 },
      "connection-2": { upload: 200, download: 200 },
    });

    expect([...initialRows].sort(compareConnectionRates).reverse()[0].id).toBe("connection-2");
    expect([...updatedRows].sort(compareConnectionRates).reverse()[0].id).toBe("connection-1");
  });
});

describe("durationToSeconds", () => {
  it("将持续时间转换为可排序的秒数", () => {
    expect(durationToSeconds("01:02:03")).toBe(3723);
    expect(durationToSeconds("实时")).toBe(0);
  });
});
