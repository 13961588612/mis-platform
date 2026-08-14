import { describe, expect, it } from "vitest";
import { splitKbSources } from "./kbSources";

describe("splitKbSources", () => {
  it("extracts kb-sources fence and leaves the answer body", () => {
    const content = [
      "Pad 退货需开启退货开关。",
      "",
      "```kb-sources",
      '[{"source":"Pad售后手册","score":0.91,"chunk":"退货开关：开启","page":3}]',
      "```",
    ].join("\n");
    const { body, sources } = splitKbSources(content);
    expect(body).toBe("Pad 退货需开启退货开关。");
    expect(sources).toEqual([
      { source: "Pad售后手册", score: 0.91, chunk: "退货开关：开启", page: 3, offset: null },
    ]);
  });

  it("parses legacy 来源 numbered list", () => {
    const content = "根据手册领取工牌。\n\n来源：\n1. 员工手册（相关度 0.91）\n2. 文档 13\n";
    const { body, sources } = splitKbSources(content);
    expect(body).toBe("根据手册领取工牌。");
    expect(sources[0]).toEqual({ source: "员工手册", score: 0.91 });
    expect(sources[1]).toEqual({ source: "文档 13", score: null });
  });

  it("hides an incomplete fence while streaming", () => {
    const content = "答案正文\n\n```kb-sources\n[{\"source\":";
    const { body, sources } = splitKbSources(content);
    expect(body).toBe("答案正文");
    expect(sources).toEqual([]);
  });

  it("returns original text when there are no sources", () => {
    const { body, sources } = splitKbSources("未命中");
    expect(body).toBe("未命中");
    expect(sources).toEqual([]);
  });
});
