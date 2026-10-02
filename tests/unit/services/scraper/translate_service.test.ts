import { createHash } from "node:crypto";
import { configurationSchema } from "@main/services/config";
import { NetworkClient } from "@mdcz/runtime/network";
import { type LlmApiClient, LlmTransportError, TranslateService } from "@mdcz/runtime/scrape";
import type { RuntimeLogger } from "@mdcz/runtime/shared";
import { TranslateEngine, UiLanguage, Website } from "@mdcz/shared/enums";
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

const findMappedActorName = vi.fn();
const findMappedGenreName = vi.fn();

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

const createTranslateService = (networkClient: NetworkClient, llmApiClient: LlmApiClient, logger?: RuntimeLogger) =>
  new TranslateService(networkClient, {
    llmApiClient,
    logger,
    mappingStore: {
      findMappedActorName,
      findMappedGenreName,
    },
  });

const createLogger = () => ({
  debug: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
  warn: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
});

describe("TranslateService term consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findMappedActorName).mockResolvedValue(null);
    vi.mocked(findMappedGenreName).mockResolvedValue(null);
  });

  it("batches metadata and preserves translated names", async () => {
    const plot = "这是あき的旅行日记。";
    const generateText = vi.fn().mockResolvedValue(JSON.stringify({ title: "中文标题", plot, genres: ["统一译名"] }));
    const llmApiClient = createLlmApiClient(generateText);

    const service = createTranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: "Japanese title",
        plot: "Japanese plot",
        number: "DLDSS-463",
        actors: ["同一日语词", "同一日语词"],
        genres: ["同じ日本語"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('"title":"Japanese title","plot":"Japanese plot","genres":["同じ日本語"]'),
        reasoning: "default",
      }),
      undefined,
    );
    expect(translated.data.actors).toEqual(["同一日语词", "同一日语词"]);
    expect(translated.data.title_zh).toBe("中文标题");
    expect(translated.data.plot_zh).toBe(plot);
    expect(translated.data.genres).toEqual(["统一译名"]);
  });

  it("applies actor/genre mappings without llm and preserves actor photos", async () => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);

    vi.mocked(findMappedActorName).mockResolvedValue("小花暖");
    vi.mocked(findMappedGenreName).mockImplementation(async (term) => (term === "Sample" ? "" : "小花暖"));

    const service = createTranslateService(new NetworkClient({}), llmApiClient);
    const config = createBaseConfig();

    const translated = await service.translateCrawlerData(
      {
        title: " ",
        number: "DLDSS-463",
        actors: ["小花のん"],
        actor_profiles: [{ name: "小花のん", photo_url: "https://img.example.com/actor-a.jpg" }],
        genres: ["小花のん", "Sample", "Sample"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(vi.mocked(findMappedActorName)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(findMappedGenreName)).toHaveBeenCalledTimes(2);
    expect(translated.data.actors).toEqual(["小花暖"]);
    expect(translated.data.genres).toEqual(["小花暖"]);
    expect(translated.data.actor_profiles).toEqual([
      {
        name: "小花暖",
        aliases: ["小花のん"],
        photo_url: "https://img.example.com/actor-a.jpg",
      },
    ]);
  });

  it.each([
    [
      "capped Retry-After",
      Object.assign(new Error("rate limited"), { status: 429, headers: new Headers({ "Retry-After": "120" }) }),
      15_000,
    ],
    [
      "default rate-limit delay",
      Object.assign(new Error("rate limited"), { status: 429, headers: new Headers() }),
      1000,
    ],
    [
      "timeout",
      new Error("LLM request failed: Error reading response stream: reqwest::Error { kind: Body, source: TimedOut }"),
      1000,
    ],
  ] as const)("retries recoverable llm failures with %s", async (_name, error, delay) => {
    const generateText = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("重试成功");
    const service = createTranslateService(new NetworkClient({}), createLlmApiClient(generateText));
    await expect(service.translateText("hello", "zh_cn", createBaseConfig())).resolves.toBe("重试成功");
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledExactlyOnceWith(delay, undefined, undefined);
  });

  it("retries typed transport errors until llmMaxRetries is exhausted", async () => {
    const transportError = new LlmTransportError(
      "LLM request failed for https://api.deepseek.com/responses: Error reading response stream: kind: Body",
      new Error("body timed out"),
    );
    const generateText = vi.fn().mockRejectedValue(transportError);
    const logger = createLogger();
    const service = createTranslateService(new NetworkClient({}), createLlmApiClient(generateText), logger);
    const config = createBaseConfig();
    config.translate.llmMaxRetries = 3;

    await expect(service.translateText("hello", "zh_cn", config)).rejects.toBe(transportError);

    expect(generateText).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("transport error (1/3)"));
  });

  it.each([
    [null, "engine returned no translation"],
    [" English plot\r\n", "source echoed"],
    [" ", "engine returned no translation"],
  ])("logs field fallback without response content (%s)", async (plot, reason) => {
    const generateText =
      plot === null
        ? vi.fn().mockRejectedValue(new Error("provider failed"))
        : vi.fn().mockResolvedValue(JSON.stringify({ title: "中文标题", plot, genres: ["剧情"] }));
    const logger = createLogger();
    const network = new NetworkClient({});
    const getJson = vi.spyOn(network, "getJson").mockRejectedValue(new Error("unexpected Google fallback"));
    const service = createTranslateService(network, createLlmApiClient(generateText), logger);
    const config = createBaseConfig();
    config.translate.llmMaxRetries = 0;

    const result = await service.translateCrawlerData(
      {
        title: "English title",
        plot: "English plot",
        number: "HMN-869",
        actors: [],
        genres: ["Drama"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(result.data.plot_zh).toBeUndefined();
    expect(getJson).not.toHaveBeenCalled();
    if (plot === null) {
      expect(result.data.title_zh).toBeUndefined();
      expect(result.data.genres).toEqual(["Drama"]);
      expect(generateText).toHaveBeenCalledTimes(1);
    }
    if (plot === null || !plot.trim()) {
      expect(result.error).toContain(plot === null ? "provider failed" : "invalid structured output");
    } else {
      expect(logger.warn).toHaveBeenCalledWith(
        `Translation engine failed for plot (HMN-869), returning original text: ${reason}`,
      );
    }
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("English plot");
  });

  it.each([
    ["empty response", new Error('LLM response did not contain text: {"choices":[{"message":{"role":"assistant"}}]}')],
    [
      "HTTP 500",
      Object.assign(new Error("server error"), { status: 500, headers: new Headers({ "Retry-After": "120" }) }),
    ],
  ] as const)("propagates non-retryable llm failures: %s", async (_name, error) => {
    const generateText = vi.fn().mockRejectedValue(error);
    const service = createTranslateService(new NetworkClient({}), createLlmApiClient(generateText));
    await expect(service.translateText("hello", "zh_cn", createBaseConfig())).rejects.toBe(error);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it.each([
    [TranslateEngine.GOOGLE, "", "", "zh-CN"],
    [TranslateEngine.DEEPL, "pro", "", "zh-TW"],
    [TranslateEngine.BAIDU, "", "", "zh-TW"],
  ] as const)("restores metadata positions for %s (%s, %s, %s)", async (engine, key, url, targetLanguage) => {
    const generateText = vi.fn();
    const llmApiClient = createLlmApiClient(generateText);
    const networkClient = new NetworkClient({});
    const outputs = ["标题", "第一行\n第二行", "剧情"];
    const getJson = vi.spyOn(networkClient, "getJson").mockImplementation(async () => [[[outputs.shift()]]]);
    const postJson = vi.spyOn(networkClient, "postJson").mockImplementation(async (_url, payload) => ({
      translations: (payload as { text: string[] }).text.map(() => ({ text: outputs.shift() })),
    }));
    const postText = vi.spyOn(networkClient, "postText").mockResolvedValue(
      JSON.stringify({
        error_code: 52000,
        trans_result: ["标题", "第一行", "第二行", "剧情"].map((dst) => ({ src: "source", dst })),
      }),
    );

    const service = createTranslateService(networkClient, llmApiClient);
    const config = configurationSchema.parse({
      translate: {
        engine,
        deeplApiKey: key,
        deeplApiUrl: url,
        baiduAppId: "app",
        baiduSecretKey: "secret",
        targetLanguage,
        enableTranslation: true,
      },
    });

    const translated = await service.translateCrawlerData(
      {
        title: "Original title",
        plot: "First line\nSecond line",
        number: "DLDSS-463",
        actors: [],
        genres: ["剧情", "Drama", "劇情"],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(translated.error).toBeNull();
    expect(translated.data.title_zh).toBe(targetLanguage === "zh-TW" ? "標題" : "标题");
    expect(translated.data.plot_zh).toBe("第一行\n第二行");
    expect(translated.data.genres).toEqual(Array(3).fill(targetLanguage === "zh-TW" ? "劇情" : "剧情"));
    expect(getJson).toHaveBeenCalledTimes(engine === TranslateEngine.GOOGLE ? 3 : 0);
    expect(postJson).toHaveBeenCalledTimes(engine === TranslateEngine.DEEPL ? 1 : 0);
    expect(postText).toHaveBeenCalledTimes(engine === TranslateEngine.BAIDU ? 1 : 0);
  });

  it("converts Chinese fields and Han-only genres locally", async () => {
    const network = new NetworkClient({});
    const getJson = vi.spyOn(network, "getJson").mockRejectedValue(new Error("network unavailable"));
    const generateText = vi.fn();
    const service = createTranslateService(network, createLlmApiClient(generateText));
    const config = createBaseConfig();
    for (const targetLanguage of [UiLanguage.ZH_CN, UiLanguage.ZH_TW] as const) {
      config.translate.targetLanguage = targetLanguage;
      const result = await service.translateCrawlerData(
        {
          title: "中文标题",
          number: "TEST-CHINESE",
          actors: [],
          genres: ["剧情", "劇情", "4時間以上作品", "単体作品", "独占配信"],
          scene_images: [],
          website: Website.DMM,
        },
        config,
      );
      expect(result.error).toBeNull();
      expect(result.data.genres).toEqual(
        targetLanguage === "zh-TW"
          ? ["劇情", "劇情", "4時間以上作品", "単體作品", "獨佔配信"]
          : ["剧情", "剧情", "4时间以上作品", "単体作品", "独占配信"],
      );
    }
    expect(getJson).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("uses DeepL endpoint authentication and batch sizes appropriate to the endpoint", async () => {
    for (const [key, url, endpoint, target, language, batches] of [
      ["free:fx", "", "https://api-free.deepl.com/v2/translate", "zh_cn", "ZH-HANS", [2]],
      ["pro", "", "https://api.deepl.com/v2/translate", "zh_tw", "ZH-HANT", [2]],
      ["", "http://localhost:1188/v2/translate", "http://localhost:1188/v2/translate", "zh_cn", "ZH-HANS", [1, 1]],
      ["token", "http://localhost:1188/v2/translate", "http://localhost:1188/v2/translate", "zh_cn", "ZH-HANS", [1, 1]],
    ] as const) {
      const network = new NetworkClient({});
      const postJson = vi.spyOn(network, "postJson").mockImplementation(async (_url, payload) => ({
        translations: (payload as { text: string[] }).text.map((text) => ({ text: `译文 ${text}` })),
      }));
      const config = createBaseConfig();
      Object.assign(config.translate, { engine: TranslateEngine.DEEPL, deeplApiKey: key, deeplApiUrl: url });
      const service = createTranslateService(network, createLlmApiClient());
      await expect(
        service.translateMetadata({ title: "Title", plot: null, genres: ["Drama"] }, target, config),
      ).resolves.toEqual({ title: "译文 Title", plot: null, genres: ["译文 Drama"] });
      expect(postJson.mock.calls.map(([, payload]) => (payload as { text: string[] }).text.length)).toEqual(batches);
      for (const [actualUrl, payload, init] of postJson.mock.calls) {
        expect(actualUrl).toBe(endpoint);
        expect(payload).toMatchObject({ target_lang: language });
        expect(init).toEqual({
          signal: undefined,
          headers: key ? { Authorization: `DeepL-Auth-Key ${key}` } : undefined,
        });
      }
    }
  });

  it("restores metadata positions across DeepL batches with an absent title", async () => {
    const network = new NetworkClient({});
    const postJson = vi.spyOn(network, "postJson").mockImplementation(async (_url, payload) => ({
      translations: (payload as { text: string[] }).text.map((text) => ({ text: `译文 ${text}` })),
    }));
    const config = createBaseConfig();
    Object.assign(config.translate, { engine: TranslateEngine.DEEPL, deeplApiKey: "pro", targetLanguage: "zh-TW" });
    const genres = Array.from({ length: 51 }, (_, index) => `Genre ${index}`);
    const service = createTranslateService(network, createLlmApiClient());
    const result = await service.translateCrawlerData(
      {
        title: " ",
        plot: "Original plot",
        number: "TEST-2",
        genres,
        actors: [],
        scene_images: [],
        website: Website.DMM,
      },
      config,
    );
    expect(result.error).toBeNull();
    expect(result.data.title_zh).toBeUndefined();
    expect(result.data.plot_zh).toBe("譯文 Original plot");
    expect(result.data.genres).toEqual(genres.map((genre) => `譯文 ${genre}`));
    const batches = postJson.mock.calls.map(([, payload]) => (payload as { text: string[] }).text);
    expect(batches.map((batch) => batch.length)).toEqual([50, 2]);
    expect(batches.flat()).toEqual(["Original plot", ...genres]);
  });

  it("preserves local mappings and provider errors while propagating cancellation", async () => {
    for (const [engine, failure, message] of [
      [TranslateEngine.GOOGLE, "network", "Google unavailable"],
      [TranslateEngine.OPENAI, "network", "LLM unavailable"],
      [TranslateEngine.DEEPL, "quota", "HTTP 456: quota exhausted"],
      [TranslateEngine.DEEPL, "count", "DeepL translation result count mismatch"],
      [TranslateEngine.BAIDU, "rate", "Baidu translate error 54003: Rate limited"],
      [TranslateEngine.BAIDU, "count", "Baidu translation result count mismatch"],
    ] as const) {
      const network = new NetworkClient({});
      vi.spyOn(network, "getJson").mockRejectedValue(new Error(message));
      if (failure === "quota") vi.spyOn(network, "postJson").mockRejectedValue(new Error(message));
      else vi.spyOn(network, "postJson").mockResolvedValue({ translations: [] });
      vi.spyOn(network, "postText").mockResolvedValue(
        JSON.stringify(failure === "rate" ? { error_code: "54003", error_msg: "Rate limited" } : { trans_result: [] }),
      );
      const config = createBaseConfig();
      Object.assign(config.translate, { engine, deeplApiKey: "key", baiduAppId: "app", baiduSecretKey: "secret" });
      findMappedActorName.mockResolvedValue("小花暖");
      findMappedGenreName.mockImplementation(async (term) => (term === "Mapped" ? "剧情" : null));
      const data = {
        title: "Original title",
        plot: "Original plot",
        number: "TEST-1",
        actors: ["小花のん"],
        actor_profiles: [{ name: "小花のん", photo_url: "https://example.test/actor.jpg" }],
        genres: ["Mapped", "Drama"],
        scene_images: [],
        website: Website.DMM,
      };
      const service = createTranslateService(
        network,
        createLlmApiClient(vi.fn().mockRejectedValue(new Error(message))),
      );
      await expect(service.translateCrawlerData(data, config)).resolves.toEqual({
        data: {
          ...data,
          actors: ["小花暖"],
          genres: ["剧情", "Drama"],
          actor_profiles: [{ name: "小花暖", aliases: ["小花のん"], photo_url: "https://example.test/actor.jpg" }],
          title_zh: undefined,
          plot_zh: undefined,
        },
        error: message,
      });
    }
    const controller = new AbortController();
    controller.abort();
    const service = createTranslateService(new NetworkClient({}), createLlmApiClient());
    await expect(
      service.translateMetadata(
        { title: "Title", plot: null, genres: [] },
        "zh_cn",
        createBaseConfig(),
        controller.signal,
      ),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("signs and chunks Baidu text within the UTF-8 byte limit while preserving lines", async () => {
    const network = new NetworkClient({});
    const setDomainLimit = vi.spyOn(network, "setDomainLimit");
    const postText = vi.spyOn(network, "postText").mockImplementation(async (url, body, init) => {
      expect(url).toBe("https://fanyi-api.baidu.com/api/trans/vip/translate");
      expect(init?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      const params = new URLSearchParams(body);
      const q = params.get("q");
      if (!q) throw new Error("Missing translation text");
      expect(Buffer.byteLength(q, "utf8")).toBeLessThanOrEqual(6000);
      expect(params.get("to")).toBe("cht");
      expect(params.get("from")).toBe("auto");
      expect(params.get("appid")).toBe("app");
      expect(params.get("sign")).toBe(
        createHash("md5")
          .update(`app${q}${params.get("salt")}secret`)
          .digest("hex"),
      );
      return JSON.stringify({ trans_result: q.split("\n").map((src) => ({ src, dst: "译文" })) });
    });
    const config = createBaseConfig();
    Object.assign(config.translate, { engine: TranslateEngine.BAIDU, baiduAppId: "app", baiduSecretKey: "secret" });
    const source = `${"a".repeat(6001)}${"あ".repeat(1000)}${"\u{1F600}".repeat(1000)}\nつぎ`;
    const service = createTranslateService(network, createLlmApiClient());
    await expect(service.translateText(source, "zh_tw", config)).resolves.toBe("譯文譯文譯文\n譯文");
    expect(setDomainLimit).toHaveBeenCalledExactlyOnceWith("fanyi-api.baidu.com", 1, 1);
    expect(postText).toHaveBeenCalledTimes(3);
    const sentChunks = postText.mock.calls.flatMap(([, body]) => new URLSearchParams(body).get("q")?.split("\n") ?? []);
    expect(sentChunks.slice(0, 3).join("")).toBe(source.split("\n")[0]);
    expect(sentChunks[3]).toBe("つぎ");
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

    const service = createTranslateService(new NetworkClient({}), llmApiClient);
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

    const service = createTranslateService(new NetworkClient({}), llmApiClient);
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

    const service = createTranslateService(networkClient, llmApiClient);
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

    const service = createTranslateService(new NetworkClient({}), llmApiClient);
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
