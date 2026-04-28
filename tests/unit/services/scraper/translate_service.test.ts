import { configurationSchema } from "@main/services/config";
import { NetworkClient } from "@main/services/network";
import { TranslateService } from "@main/services/scraper/TranslateService";
import type { LlmApiClient } from "@main/services/scraper/translate/engines/LlmApiClient";
import { TranslateEngine, Website } from "@mdcz/shared/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sleepMock } = vi.hoisted(() => {
  return {
    sleepMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("node:timers/promises", () => {
  return {
    setTimeout: sleepMock,
  };
});

vi.mock("@main/utils/translate", () => {
  return {
    appendMappingCandidate: vi.fn(),
    findMappedActorName: vi.fn(),
    findMappedGenreName: vi.fn(),
  };
});

import { appendMappingCandidate, findMappedActorName, findMappedGenreName } from "@main/utils/translate";

const createBaseConfig = () => {
  return configurationSchema.parse({
    translate: {
      engine: TranslateEngine.OPENAI,
      llmApiKey: "test-key",
      enableTranslation: true,
      llmMaxRetries: 1,
    },
  });
};

const createLlmApiClient = (generateText = vi.fn()) => {
  return {
    generateText,
  } as unknown as LlmApiClient;
};

describe("TranslateService term consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appendMappingCandidate).mockResolvedValue(undefined);
    vi.mocked(findMappedActorName).mockResolvedValue(null);
    vi.mocked(findMappedGenreName).mockResolvedValue(null);
    sleepMock.mockClear();
  });

  it("keeps actor original term and only translates genre term", async () => {
    const generateText = vi.fn().mockResolvedValue("统一译名");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: ["同一日语词", "同一日语词"],
        genres: ["同一日语词"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendMappingCandidate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendMappingCandidate)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "genre",
        keyword: "同一日语词",
      }),
    );
    expect(translated.actors).toEqual(["同一日语词", "同一日语词"]);
    expect(translated.genres).toEqual(["统一译名"]);
  });

  it("prefers mapped actor/genre names and avoids llm", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);

    vi.mocked(findMappedActorName).mockResolvedValue("小花暖");
    vi.mocked(findMappedGenreName).mockResolvedValue("小花暖");

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: ["小花のん"],
        genres: ["小花のん"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(vi.mocked(appendMappingCandidate)).not.toHaveBeenCalled();
    expect(vi.mocked(findMappedActorName)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(findMappedGenreName)).toHaveBeenCalledTimes(1);
    expect(translated.actors).toEqual(["小花暖"]);
    expect(translated.genres).toEqual(["小花暖"]);
  });

  it("keeps actor profile photos attached after actor alias normalization", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);

    vi.mocked(findMappedActorName).mockResolvedValue("小花暖");

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: ["小花のん"],
        actor_profiles: [
          {
            name: "小花のん",
            photo_url: "https://img.example.com/actor-a.jpg",
          },
        ],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(vi.mocked(findMappedActorName)).toHaveBeenCalledTimes(1);
    expect(translated.actors).toEqual(["小花暖"]);
    expect(translated.actor_profiles).toEqual([
      {
        name: "小花暖",
        aliases: ["小花のん"],
        photo_url: "https://img.example.com/actor-a.jpg",
      },
    ]);
  });

  it("retries llm request once when 429 includes Retry-After and caps wait to 15s", async () => {
    const rateLimitedError = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: new Headers({
        "Retry-After": "120",
      }),
    });

    const generateText = vi.fn().mockRejectedValueOnce(rateLimitedError).mockResolvedValueOnce("Retry 成功");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("Retry 成功");

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(15_000, undefined, undefined);
  });

  it("retries llm request after a short delay when 429 omits Retry-After", async () => {
    const rateLimitedError = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: new Headers(),
    });

    const generateText = vi.fn().mockRejectedValueOnce(rateLimitedError).mockResolvedValueOnce("Retry 成功");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("Retry 成功");

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000, undefined, undefined);
  });

  it("retries llm request after a timeout", async () => {
    const timeoutError = new Error(
      "LLM request failed for https://generativelanguage.googleapis.com/v1beta/openai/chat/completions: Request timeout (10000 ms) exceeded.",
    );
    const generateText = vi.fn().mockRejectedValueOnce(timeoutError).mockResolvedValueOnce("超时重试成功");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("超时重试成功");

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000, undefined, undefined);
  });

  it("does not retry llm request when the provider returns an empty successful response", async () => {
    const emptyResponseError = new Error(
      'LLM response did not contain text for https://generativelanguage.googleapis.com/v1beta/openai/chat/completions: {"choices":[{"message":{"role":"assistant"}}],"usage":{"completion_tokens":0}}',
    );
    const generateText = vi.fn().mockRejectedValue(emptyResponseError);
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, llmApiClient);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("hello");

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry llm request for non-429 errors", async () => {
    const serverError = Object.assign(new Error("server error"), {
      status: 500,
      headers: new Headers({
        "Retry-After": "120",
      }),
    });

    const generateText = vi.fn().mockRejectedValue(serverError);
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, llmApiClient);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("hello");

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not write untranslated non-chinese source text into translated crawler fields", async () => {
    const generateText = vi.fn().mockRejectedValue(new Error("llm failed"));
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: "BEST OF 彼女の休日",
        plot: "An English synopsis",
        number: "DLDSS-463",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(translated.title_zh).toBeUndefined();
    expect(translated.plot_zh).toBeUndefined();
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("does not call llm for genre terms when the selected engine is google", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockResolvedValue([[["剧情"]]] as unknown);

    const service = new TranslateService(networkClient, llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.GOOGLE,
        llmApiKey: "test-key",
        enableTranslation: true,
      },
    });

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: [],
        genres: ["Drama"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(translated.genres).toEqual(["剧情"]);
  });

  it("keeps original genre terms after llm term translation fails", async () => {
    const generateText = vi.fn().mockRejectedValue(new Error("rate limited"));
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockResolvedValue([[["剧情"]]] as unknown);

    const service = new TranslateService(networkClient, llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: [],
        genres: ["Drama"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(networkClient.getJson).not.toHaveBeenCalled();
    expect(translated.genres).toEqual(["Drama"]);
  });

  it("normalizes unsupported translation target config values to zh-CN without migration", () => {
    const config = configurationSchema.parse({
      translate: {
        targetLanguage: "ja-JP",
      },
    });

    expect(config.translate.targetLanguage).toBe("zh-CN");
  });

  it("lets the llm auto-detect mixed-language input and target traditional chinese directly", async () => {
    const generateText = vi.fn().mockResolvedValue("混合語言標題");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.OPENAI,
        llmApiKey: "test-key",
        enableTranslation: true,
        llmMaxRetries: 1,
        targetLanguage: "zh-TW",
      },
    });

    await expect(service.translateText("BEST OF 彼女の休日", "zh_tw", config)).resolves.toBe("混合語言標題");

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("繁体中文"),
      }),
      undefined,
    );
  });

  it("allows custom base url without api key", async () => {
    const generateText = vi.fn().mockResolvedValue("本地翻译");
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.OPENAI,
        llmApiKey: "",
        llmBaseUrl: "http://127.0.0.1:11434/v1",
        enableTranslation: true,
        llmMaxRetries: 1,
      },
    });

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("本地翻译");

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
      undefined,
    );
  });

  it("skips llm calls for the default OpenAI base url when api key is empty", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.OPENAI,
        llmApiKey: "",
        enableTranslation: true,
        llmMaxRetries: 1,
      },
    });

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("hello");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("short-circuits chinese input and converts the target locally", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);

    const service = new TranslateService(new NetworkClient({}), llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.OPENAI,
        llmApiKey: "test-key",
        enableTranslation: true,
        llmMaxRetries: 1,
      },
    });

    await expect(service.translateText("简体标题", "zh_tw", config)).resolves.toBe("簡體標題");
    expect(generateText).not.toHaveBeenCalled();
  });
});
