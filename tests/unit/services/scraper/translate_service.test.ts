import { configurationSchema } from "@main/services/config";
import { NetworkClient } from "@main/services/network";
import { TranslateService } from "@main/services/scraper/TranslateService";
import { TranslateEngine, Website } from "@shared/enums";
import type OpenAI from "openai";
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

describe("TranslateService term consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appendMappingCandidate).mockResolvedValue(undefined);
    vi.mocked(findMappedActorName).mockResolvedValue(null);
    vi.mocked(findMappedGenreName).mockResolvedValue(null);
    sleepMock.mockClear();
  });

  it("keeps actor original term and only translates genre term", async () => {
    const completionCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "统一译名" } }],
    });

    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    vi.mocked(findMappedActorName).mockResolvedValue(null);
    vi.mocked(findMappedGenreName).mockResolvedValue(null);

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
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

    expect(completionCreate).toHaveBeenCalledTimes(1);
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
    const completionCreate = vi.fn();
    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    vi.mocked(findMappedActorName).mockResolvedValue("小花暖");
    vi.mocked(findMappedGenreName).mockResolvedValue("小花暖");

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
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

    expect(completionCreate).not.toHaveBeenCalled();
    expect(vi.mocked(appendMappingCandidate)).not.toHaveBeenCalled();
    expect(vi.mocked(findMappedActorName)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(findMappedGenreName)).toHaveBeenCalledTimes(1);
    expect(translated.actors).toEqual(["小花暖"]);
    expect(translated.genres).toEqual(["小花暖"]);
  });

  it("keeps actor profile photos attached after actor alias normalization", async () => {
    const completionCreate = vi.fn();
    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    vi.mocked(findMappedActorName).mockResolvedValue("小花暖");

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
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

    expect(completionCreate).not.toHaveBeenCalled();
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

  it("retries OpenAI request once when 429 includes Retry-After and caps wait to 15s", async () => {
    const rateLimitedError = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: new Headers({
        "Retry-After": "120",
      }),
    });

    const completionCreate = vi
      .fn()
      .mockRejectedValueOnce(rateLimitedError)
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Retry 成功" } }],
      });

    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("Retry 成功");

    expect(completionCreate).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(15_000, undefined, undefined);
  });

  it("does not retry OpenAI request for non-429 errors", async () => {
    const serverError = Object.assign(new Error("server error"), {
      status: 500,
      headers: new Headers({
        "Retry-After": "120",
      }),
    });

    const completionCreate = vi.fn().mockRejectedValue(serverError);
    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, openAiFactory);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("hello");

    expect(completionCreate).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not write untranslated non-chinese source text into translated crawler fields", async () => {
    const completionCreate = vi.fn().mockRejectedValue(new Error("openai failed"));
    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockRejectedValue(new Error("network disabled"));

    const service = new TranslateService(networkClient, openAiFactory);
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
    expect(completionCreate).toHaveBeenCalledTimes(2);
  });

  it("does not call OpenAI for genre terms when the selected engine is google", async () => {
    const completionCreate = vi.fn();
    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const networkClient = new NetworkClient({});
    vi.spyOn(networkClient, "getJson").mockResolvedValue([[["剧情"]]] as unknown);

    const service = new TranslateService(networkClient, openAiFactory);
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

    expect(completionCreate).not.toHaveBeenCalled();
    expect(translated.genres).toEqual(["剧情"]);
  });

  it("normalizes unsupported translation target config values to zh-CN without migration", () => {
    const config = configurationSchema.parse({
      translate: {
        targetLanguage: "ja-JP",
      },
    });

    expect(config.translate.targetLanguage).toBe("zh-CN");
  });

  it("lets the LLM auto-detect mixed-language input and target traditional chinese directly", async () => {
    const completionCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "混合語言標題" } }],
    });

    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
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

    expect(completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("繁体中文"),
          }),
        ],
      }),
      { signal: undefined },
    );
  });

  it("short-circuits chinese input and converts the target locally", async () => {
    const completionCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "繁體標題" } }],
    });

    const openAiFactory = () =>
      ({
        chat: {
          completions: {
            create: completionCreate,
          },
        },
      }) as unknown as OpenAI;

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
    const config = configurationSchema.parse({
      translate: {
        engine: TranslateEngine.OPENAI,
        llmApiKey: "test-key",
        enableTranslation: true,
        llmMaxRetries: 1,
      },
    });

    await expect(service.translateText("简体标题", "zh_tw", config)).resolves.toBe("簡體標題");
    expect(completionCreate).not.toHaveBeenCalled();
  });
});
