import { describe, expect, it } from "vitest";
import type { TrafficPoint } from "../types";
import { buildTrafficChartData } from "./trafficHistory";

function point(sampledAt: number, download: number, upload = 0): TrafficPoint {
  return { time: "", sampledAt, download, upload };
}

describe("buildTrafficChartData", () => {
  it("24 小时视图固定显示 0 至 24 点，并按小时取最后一次采样", () => {
    const now = new Date(2026, 5, 28, 10, 30).getTime();
    const history = [
      point(new Date(2026, 5, 28, 8, 10).getTime(), 1),
      point(new Date(2026, 5, 28, 8, 55).getTime(), 3),
    ];

    const chart = buildTrafficChartData(history, "24h", [], now);

    expect(chart.domain).toEqual([0, 24]);
    expect(chart.ticks).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(chart.data).toHaveLength(11);
    expect(chart.data[8].download).toBe(3);
    expect(chart.data[9].download).toBe(0);
  });

  it("7 天视图包含今天在内的最近 7 个自然日", () => {
    const now = new Date(2026, 5, 28, 12).getTime();
    const chart = buildTrafficChartData([], "7d", [], now);

    expect(chart.tickLabels).toEqual(["06-22", "06-23", "06-24", "06-25", "06-26", "06-27", "06-28"]);
    expect(chart.data).toHaveLength(7);
    expect(chart.data[0].time).toBe("2026-06-22");
  });

  it("30 天视图跨月生成每天一个刻度", () => {
    const now = new Date(2026, 2, 5, 12).getTime();
    const chart = buildTrafficChartData([], "30d", [], now);

    expect(chart.tickLabels).toHaveLength(30);
    expect(chart.tickLabels[0]).toBe("02-04");
    expect(chart.tickLabels[29]).toBe("03-05");
  });

  it("兼容仅包含 HH:mm 的旧采样记录", () => {
    const now = new Date(2026, 5, 28, 10, 30).getTime();
    const legacy: TrafficPoint = { time: "09:15", download: 5, upload: 2 };

    const chart = buildTrafficChartData([legacy], "24h", [], now);

    expect(chart.data[9]).toMatchObject({ download: 5, upload: 2 });
  });
});
