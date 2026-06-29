import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessIcon } from "./ProcessIcon";

describe("ProcessIcon", () => {
  it("存在应用图标时渲染图片", () => {
    const markup = renderToStaticMarkup(
      <ProcessIcon app="example.exe" icon="data:image/png;base64,AAAA" />,
    );

    expect(markup).toContain("<img");
    expect(markup).toContain("data:image/png;base64,AAAA");
  });

  it("图标缺失时渲染统一兜底图标", () => {
    const markup = renderToStaticMarkup(<ProcessIcon app="内核未识别" icon="" />);

    expect(markup).not.toContain("<img");
    expect(markup).toContain("anticon-appstore");
  });
});
