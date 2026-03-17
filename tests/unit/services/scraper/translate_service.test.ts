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
      enableGoogleFallback: false,
      llmMaxTry: 1,
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
        sample_images: [],
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
        sample_images: [],
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
        sample_images: [],
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

    const service = new TranslateService(new NetworkClient({}), openAiFactory);
    const config = createBaseConfig();

    await expect(service.translateText("hello", "zh_cn", config)).resolves.toBe("hello");

    expect(completionCreate).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });
});
