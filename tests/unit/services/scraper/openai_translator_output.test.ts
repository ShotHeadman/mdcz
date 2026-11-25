import { cleanTranslationOutput } from "@mdcz/runtime/translate";
import { describe, expect, it } from "vitest";

describe("OpenAiTranslator output cleanup", () => {
  const prompt = "将以下内容翻译为简体中文。\nある日の暮方の事である。";
  const source = "ある日の暮方の事である。";

  it("accepts plain and multiline translations", () => {
    expect(cleanTranslationOutput("那是某天傍晚的事。", prompt, source)).toBe("那是某天傍晚的事。");
    expect(cleanTranslationOutput("第一行\n第二行", prompt, source)).toBe("第一行\n第二行");
  });

  it.each([
    ["empty output", ""],
    ["prompt echo", prompt],
    ["source echo", source],
  ])("rejects %s", (_name, output) => {
    expect(cleanTranslationOutput(output, prompt, source)).toBeNull();
  });
});
