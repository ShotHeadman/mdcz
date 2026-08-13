import { cleanTranslationOutput } from "@mdcz/runtime/translate";
import { describe, expect, it } from "vitest";

describe("OpenAiTranslator output cleanup", () => {
  const prompt = "将以下内容翻译为简体中文。\nある日の暮方の事である。";
  const source = "ある日の暮方の事である。";

  it("accepts plain and multiline translations", () => {
    expect(cleanTranslationOutput("那是某天傍晚的事。", prompt, source)).toBe("那是某天傍晚的事。");
    expect(cleanTranslationOutput("第一行\n第二行", prompt, source)).toBe("第一行\n第二行");
  });

  it("strips one complete leading think block", () => {
    expect(
      cleanTranslationOutput("<think>We need translate this sentence.</think>\n那是某天傍晚的事。", prompt, source),
    ).toBe("那是某天傍晚的事。");
  });

  it.each([
    ["empty output", ""],
    ["reasoning only", "<think>We need translate this sentence.</think>"],
    ["prompt echo", prompt],
    ["reinforced prompt echo", `${prompt}\n\n只输出最终译文，不要输出思考过程、解释、提示词或原文。`],
    ["source echo", source],
  ])("rejects %s", (_name, output) => {
    expect(cleanTranslationOutput(output, prompt, source)).toBeNull();
  });
});
