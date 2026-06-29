import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Latency } from "./Common";

describe("Latency", () => {
  it("延迟为 0 时显示未测速且隐藏信号条", () => {
    const markup = renderToStaticMarkup(<Latency value={0} />);

    expect(markup).toContain("未测速");
    expect(markup).not.toContain("0 ms");
    expect(markup).not.toContain("signal-bars");
  });

  it("有效延迟继续显示毫秒数和信号条", () => {
    const markup = renderToStaticMarkup(<Latency value={88} />);

    expect(markup).toContain("88 ms");
    expect(markup).toContain("signal-bars");
  });
});
