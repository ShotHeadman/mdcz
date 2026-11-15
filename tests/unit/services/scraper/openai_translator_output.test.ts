import { cleanTranslationOutput } from "@mdcz/runtime/translate";
import { describe, expect, it } from "vitest";

describe("OpenAiTranslator output cleanup", () => {
  const prompt = "将以下内容翻译为简体中文。\nある日の暮方の事である。";
  const source = "ある日の暮方の事である。";

  it("accepts plain and multiline translations", () => {
    expect(cleanTranslationOutput("那是某天傍晚的事。", prompt, source)).toBe("那是某天傍晚的事。");
    expect(cleanTranslationOutput("第一行\n第二行", prompt, source)).toBe("第一行\n第二行");
    for (const text of [
      "抱歉，我无法出席明天的会议。",
      "无法打开的门",
      "他抱歉地说，今天无法按时到达。",
      "I cannot attend the meeting tomorrow.",
      "抱歉信的翻译已经完成。",
      "编辑建议删去敏感细节后的版本更清楚。",
      "志愿者可以帮助翻译会议记录。",
      "该文本包含关于旅行的内容。",
      "该请求涉及图书馆开放时间。",
      "人物在日记里提到敏感内容这个词。",
      "角色说我无法翻译这封信。",
      "影片讲述未成年人参与性别平等宣传活动的故事。",
      "该文本包含未成年人参加性别平等活动的故事内容。",
      "该文本包含未成年人的露骨性格描写内容。",
    ]) {
      expect(cleanTranslationOutput(text, prompt, source)).toBe(text);
      expect(cleanTranslationOutput(JSON.stringify({ translation: text }), prompt, source, true)).toBe(text);
    }
  });

  it("strips one complete leading think block", () => {
    expect(
      cleanTranslationOutput("<think>We need translate this sentence.</think>\n那是某天傍晚的事。", prompt, source),
    ).toBe("那是某天傍晚的事。");
  });

  it("rejects empty, echoed and refusal output in plain and JSON contracts", () => {
    const cases = [
      ["empty output", ""],
      ["prompt echo", prompt],
      ["source echo", source],
      ["short refusal", "无法提供该内容的翻译"],
      ["conditional translation offer", "可以帮助翻译删去敏感细节后的版本。"],
      ["policy classification warning", "该文本包含涉及受限制对象的敏感内容。"],
      ["request policy warning", "该请求涉及不允许的内容。"],
      ["specific policy classification", "该文本包含涉及未成年人的性相关内容。"],
      ["policy classification with an adjective", "该文本包含涉及未成年人的露骨性内容。"],
      ["policy classification with an English adjective", "该文本包含涉及未成年人的EXPLICIT 性内容。"],
      ["apologetic category refusal", "抱歉，我无法翻译受限制类别内容。"],
      ["apologetic refusal", "抱歉，我无法翻译这段内容。"],
      ["request refusal", "抱歉，我无法协助处理该请求。"],
      ["traditional refusal", "抱歉，我無法提供該內容的翻譯。"],
      ["English refusal", "Sorry, I can’t help with that request."],
      ["English translation refusal", "I'm sorry, but I cannot translate this text."],
      ["English contracted refusal", "I'm sorry, but I'm unable to provide a translation of this text."],
      ["first-person apology", "我很抱歉，但我无法提供此类内容的翻译。"],
    ];
    for (const [name, output] of cases) {
      expect(cleanTranslationOutput(output, prompt, source), name).toBeNull();
      expect(cleanTranslationOutput(JSON.stringify({ translation: output }), prompt, source, true), name).toBeNull();
    }
  });
});
