import { describe, expect, it } from "vitest";
import {
  buildRuntimeStreamUrl,
  formatMemoryMegabytes,
  formatRuntimeByteRate,
  parseMemoryBytes,
  parseTrafficMetrics,
} from "./runtimeMetrics";

describe("运行指标工具", () => {
  it("生成带鉴权参数的 WebSocket 地址", () => {
    expect(buildRuntimeStreamUrl("http://127.0.0.1:9090", "/traffic", "a b"))
      .toBe("ws://127.0.0.1:9090/traffic?token=a+b");
    expect(buildRuntimeStreamUrl("https://example.com/controller", "/memory", ""))
      .toBe("wss://example.com/memory");
  });

  it("解析上下行速度并过滤异常数值", () => {
    expect(parseTrafficMetrics('{"up":1024,"down":2048}')).toEqual({
      uploadBytesPerSecond: 1024,
      downloadBytesPerSecond: 2048,
    });
    expect(parseTrafficMetrics('{"up":-1,"down":"invalid"}')).toEqual({
      uploadBytesPerSecond: 0,
      downloadBytesPerSecond: 0,
    });
    expect(parseTrafficMetrics("invalid")).toBeUndefined();
  });

  it("解析并格式化内存占用", () => {
    expect(parseMemoryBytes('{"inuse":34078720}')).toBe(34078720);
    expect(formatMemoryMegabytes(34078720)).toBe("32.5 MB");
    expect(parseMemoryBytes('{"inuse":"invalid"}')).toBeUndefined();
  });

  it("仅使用 B/s 到 GB/s 格式化总速度", () => {
    expect(formatRuntimeByteRate(0)).toBe("0 B/s");
    expect(formatRuntimeByteRate(1024)).toBe("1.00 KB/s");
    expect(formatRuntimeByteRate(12 * 1024 ** 2)).toBe("12.0 MB/s");
    expect(formatRuntimeByteRate(2 * 1024 ** 4)).toBe("2048 GB/s");
  });
});
