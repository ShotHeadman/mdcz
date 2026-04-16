import { ConfigMigrationError, CURRENT_CONFIG_VERSION, runMigrations } from "@main/services/config/migrator";
import { configurationSchema } from "@main/services/config/models";
import { DEFAULT_LLM_BASE_URL } from "@shared/llm";
import { describe, expect, it } from "vitest";

const V040_ENABLED_SITES = [
  "dmm",
  "dmm_tv",
  "mgstage",
  "prestige",
  "faleno",
  "dahlia",
  "fc2",
  "javdb",
  "javbus",
  "jav321",
  "km_produce",
  "avbase",
];

const V050_ENABLED_SITES = [...V040_ENABLED_SITES, "fc2hub"];

const V040_FIELD_PRIORITY_DEFAULTS = {
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "javdb", "javbus", "jav321", "fc2"],
  plot: ["avbase", "mgstage", "dmm", "dmm_tv", "jav321", "fc2"],
  actors: ["avbase", "mgstage", "dmm", "javdb", "javbus"],
  genres: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  thumb_url: ["avbase", "mgstage", "dmm", "javdb", "javbus", "fc2"],
  poster_url: ["avbase", "mgstage", "dmm", "javdb", "javbus", "fc2"],
  sample_images: ["avbase", "mgstage", "dmm", "javdb", "javbus"],
  studio: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  director: ["avbase", "dmm", "javdb"],
  publisher: ["avbase", "dmm", "javdb", "fc2"],
  series: ["avbase", "dmm", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "javdb", "javbus", "fc2"],
  durationSeconds: ["avbase", "dmm_tv"],
  rating: ["dmm_tv", "dmm", "javdb"],
  trailer_url: ["dmm_tv", "dmm", "javbus"],
} as const;

const V050_FIELD_PRIORITY_DEFAULTS = {
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2", "fc2hub", "javdb", "javbus", "jav321"],
  plot: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2", "fc2hub", "jav321"],
  actors: ["avbase", "mgstage", "dmm", "fc2hub", "javdb", "javbus"],
  genres: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  thumb_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  poster_url: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  scene_images: ["avbase", "mgstage", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  studio: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  director: ["avbase", "dmm", "javdb"],
  publisher: ["avbase", "dmm", "fc2", "fc2hub", "javdb"],
  series: ["avbase", "dmm", "javdb", "javbus"],
  release_date: ["avbase", "dmm", "fc2", "fc2hub", "javdb", "javbus"],
  durationSeconds: ["avbase", "dmm_tv", "fc2hub"],
  rating: ["dmm_tv", "dmm", "fc2hub", "javdb"],
  trailer_url: ["dmm_tv", "dmm", "javbus"],
} as const;

const V052_FIELD_PRIORITY_DEFAULTS = {
  ...V050_FIELD_PRIORITY_DEFAULTS,
  title: ["avbase", "mgstage", "dmm", "dmm_tv", "fc2hub", "fc2", "javdb", "javbus", "jav321"],
} as const;

/**
 * Build a minimal v0.3.0 config object for testing.
 * Includes only the fields relevant to migration; Zod defaults fill the rest.
 */
function buildV030Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    network: {
      proxyType: "none",
      proxy: "",
      useProxy: false,
      timeout: 20,
      retryCount: 3,
      javdbCookie: "",
      javbusCookie: "",
    },
    scrape: {
      enabledSites: [...V040_ENABLED_SITES.filter((site) => site !== "avbase")],
      siteOrder: [...V040_ENABLED_SITES.filter((site) => site !== "avbase")],
      threadNumber: 2,
      javdbDelaySeconds: 10,
      restAfterCount: 20,
      restDuration: 60,
      siteConfigs: {},
    },
    download: {
      downloadCover: true,
      downloadPoster: true,
      downloadFanart: true,
      downloadSceneImages: true,
      downloadTrailer: true,
      downloadNfo: true,
      sceneImageConcurrency: 5,
      keepCover: false,
      keepPoster: true,
      keepFanart: true,
      keepSceneImages: true,
      keepTrailer: true,
      keepNfo: true,
    },
    server: {
      url: "http://192.168.1.100:8096",
      apiKey: "my-api-key",
      userId: "",
      actorPhotoFolder: "/photos",
    },
    paths: {
      mediaPath: "/media",
      softlinkPath: "softlink",
      successOutputFolder: "JAV_output",
      failedOutputFolder: "failed",
      sceneImagesFolder: "samples",
      configDirectory: "config",
    },
    aggregation: {
      maxParallelCrawlers: 3,
      perCrawlerTimeoutMs: 20000,
      globalTimeoutMs: 60000,
      fieldPriorities: {
        title: ["dmm", "mgstage", "dmm_tv", "fc2", "javdb", "javbus", "jav321", "km_produce"],
        plot: ["mgstage", "dmm", "dmm_tv", "fc2", "jav321"],
        actors: ["javdb", "dmm", "javbus", "mgstage", "km_produce"],
        genres: ["javdb", "fc2", "dmm", "javbus", "km_produce"],
        cover_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
        poster_url: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
        sample_images: ["mgstage", "dmm", "javbus", "javdb"],
        studio: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
        director: ["dmm", "javdb"],
        publisher: ["dmm", "fc2", "javdb"],
        series: ["dmm", "javdb", "javbus"],
        release_date: ["dmm", "fc2", "javdb", "javbus", "km_produce"],
        rating: ["javdb", "dmm"],
        trailer_url: ["dmm_tv", "dmm", "javbus"],
      },
      behavior: { preferLongerPlot: true, maxSceneImages: 30, maxActors: 50, maxGenres: 30 },
    },
    naming: {
      folderTemplate: "{actor}/{number}",
      fileTemplate: "{number}",
      actorNameMax: 3,
      actorNameMore: "等演员",
      releaseRule: "YYYY-MM-DD",
      folderNameMax: 60,
      fileNameMax: 60,
      cnwordStyle: "-C",
      umrStyle: "-破解",
      leakStyle: "-流出",
      uncensoredStyle: "",
      censoredStyle: "",
    },
    translate: {
      enableTranslation: false,
      engine: "openai",
      llmModelName: "gpt-5.2",
      llmApiKey: "",
      llmBaseUrl: "",
      llmPrompt: "请将以下文本翻译成{lang}。只输出翻译结果。\\n{content}",
      llmTemperature: 1.0,
      llmMaxTry: 3,
      llmMaxRequestsPerSecond: 1,
      enableGoogleFallback: true,
      titleLanguage: "zh-CN",
      plotLanguage: "zh-CN",
    },
    shortcuts: {
      startOrStopScrape: "S",
      searchByNumber: "N",
      searchByUrl: "U",
      deleteFile: "D",
      deleteFileAndFolder: "Shift+D",
      openFolder: "F",
      editNfo: "E",
      playVideo: "P",
    },
    ui: {
      language: "zh-CN",
      theme: "system",
      showLogsPanel: true,
      hideDock: false,
      hideMenu: false,
      hideWindowButtons: false,
    },
    behavior: {
      successFileMove: true,
      failedFileMove: true,
      successFileRename: true,
      deleteEmptyFolder: true,
      scrapeSoftlinkPath: false,
      saveLog: true,
      updateCheck: true,
    },
    ...overrides,
  };
}

/**
 * Build a minimal v0.4.0 config object for testing.
 * Includes only the fields relevant to migration; Zod defaults fill the rest.
 */
function buildV040Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configVersion: 1,
    scrape: {
      enabledSites: [...V040_ENABLED_SITES],
      siteOrder: [...V040_ENABLED_SITES],
      threadNumber: 2,
      javdbDelaySeconds: 10,
      restAfterCount: 20,
      restDuration: 60,
      siteConfigs: {},
    },
    download: {
      downloadThumb: true,
      downloadPoster: true,
      downloadFanart: true,
      downloadSceneImages: true,
      downloadTrailer: true,
      downloadNfo: true,
      sceneImageConcurrency: 5,
      keepThumb: false,
      keepPoster: true,
      keepFanart: true,
      keepSceneImages: true,
      keepTrailer: true,
      keepNfo: true,
    },
    aggregation: {
      maxParallelCrawlers: 3,
      perCrawlerTimeoutMs: 20000,
      globalTimeoutMs: 60000,
      fieldPriorities: {
        ...V040_FIELD_PRIORITY_DEFAULTS,
      },
      behavior: { preferLongerPlot: true, maxSceneImages: 30, maxActors: 50, maxGenres: 30 },
    },
    naming: {
      folderTemplate: "{actor}/{number}",
      fileTemplate: "{number}",
      actorNameMax: 3,
      actorNameMore: "等演员",
      releaseRule: "YYYY-MM-DD",
      folderNameMax: 60,
      fileNameMax: 60,
      cnwordStyle: "-C",
      umrStyle: "-破解",
      leakStyle: "-流出",
      uncensoredStyle: "",
      censoredStyle: "",
    },
    behavior: {
      successFileMove: true,
      failedFileMove: true,
      successFileRename: true,
      deleteEmptyFolder: true,
      scrapeSoftlinkPath: false,
      saveLog: true,
      updateCheck: true,
    },
    ...overrides,
  };
}

const migrate = (raw: Record<string, unknown> = buildV030Config()) => {
  const result = runMigrations(raw);
  return {
    raw,
    result,
    parsed: configurationSchema.parse(raw),
  };
};

describe("Configuration migrations", () => {
  describe("v0.3.0 → v0.4.0 → v0.5.0", () => {
    it("renames and relocates legacy fields across both releases", () => {
      const { raw } = migrate();

      const download = raw.download as Record<string, unknown>;
      const paths = raw.paths as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, unknown>;

      expect(download.downloadThumb).toBe(true);
      expect(download.keepThumb).toBe(false);
      expect(download.generateNfo).toBe(true);
      expect(download).not.toHaveProperty("downloadCover");
      expect(download).not.toHaveProperty("keepCover");
      expect(download).not.toHaveProperty("downloadNfo");

      expect(raw).not.toHaveProperty("server");
      expect(raw.emby).toEqual({
        url: "http://192.168.1.100:8096",
        apiKey: "my-api-key",
        userId: "",
      });
      expect(raw).not.toHaveProperty("jellyfin");
      expect(paths.actorPhotoFolder).toBe("/photos");

      expect(fieldPriorities.thumb_url).toEqual(V050_FIELD_PRIORITY_DEFAULTS.thumb_url);
      expect(fieldPriorities.scene_images).toEqual(V050_FIELD_PRIORITY_DEFAULTS.scene_images);
      expect(fieldPriorities).not.toHaveProperty("cover_url");
      expect(fieldPriorities).not.toHaveProperty("sample_images");
    });

    it("normalizes untouched legacy defaults to the current defaults", () => {
      const { raw, parsed } = migrate();
      const paths = raw.paths as Record<string, unknown>;
      const scrape = raw.scrape as Record<string, unknown>;

      expect(paths.sceneImagesFolder).toBe("extrafanart");
      expect(scrape.enabledSites).toEqual(V050_ENABLED_SITES);
      expect(scrape.siteOrder).toEqual(V050_ENABLED_SITES);
      expect(parsed.aggregation.fieldPriorities.title).toEqual(V052_FIELD_PRIORITY_DEFAULTS.title);
      expect(parsed.aggregation.fieldPriorities.actors).toEqual(V050_FIELD_PRIORITY_DEFAULTS.actors);
      expect(parsed.aggregation.fieldPriorities.thumb_url).toEqual(V050_FIELD_PRIORITY_DEFAULTS.thumb_url);
      expect(parsed.aggregation.fieldPriorities.poster_url).toEqual(V050_FIELD_PRIORITY_DEFAULTS.poster_url);
      expect(parsed.aggregation.fieldPriorities.scene_images).toEqual(V050_FIELD_PRIORITY_DEFAULTS.scene_images);
      expect(parsed.aggregation.fieldPriorities.durationSeconds).toEqual(["avbase", "dmm_tv", "avwikidb", "fc2hub"]);
      expect(parsed.aggregation.fieldPriorities.rating).toEqual(V050_FIELD_PRIORITY_DEFAULTS.rating);
      expect(parsed.aggregation.fieldPriorities.release_date).toEqual(V050_FIELD_PRIORITY_DEFAULTS.release_date);
    });

    it("preserves customized values instead of resetting them", () => {
      const raw = buildV030Config();
      const scrape = raw.scrape as Record<string, unknown>;
      const server = raw.server as Record<string, unknown>;
      const paths = raw.paths as Record<string, unknown>;
      const download = raw.download as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, string[]>;

      scrape.enabledSites = ["dmm"];
      scrape.siteOrder = ["dmm"];
      server.actorPhotoFolder = "";
      paths.sceneImagesFolder = "my_custom_folder";
      download.downloadNfo = false;
      fieldPriorities.title = ["javdb", "dmm"];
      fieldPriorities.sample_images = ["javbus"];
      fieldPriorities.rating = ["javdb"];

      const parsed = migrate(raw).parsed;

      expect(parsed.paths.sceneImagesFolder).toBe("my_custom_folder");
      expect(parsed.paths.actorPhotoFolder).toBe("actor_photo");
      expect(parsed.download.generateNfo).toBe(false);
      expect(parsed.naming.partStyle).toBe("RAW");
      expect(parsed.aggregation.fieldPriorities.title).toEqual(["javdb", "dmm"]);
      expect(parsed.aggregation.fieldPriorities.scene_images).toEqual(["javbus"]);
      expect(parsed.aggregation.fieldPriorities.rating).toEqual(["javdb"]);
    });

    it("keeps customized folderTemplate values and only normalizes blank templates", () => {
      const cases = [
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "{actor}",
              fileTemplate: "{number}",
            },
          }),
          expected: "{actor}",
        },
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "/{title}",
              fileTemplate: "{number}",
            },
          }),
          expected: "/{title}",
        },
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "/{originaltitle}",
              fileTemplate: "{number}",
            },
          }),
          expected: "/{originaltitle}",
        },
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "   ",
              fileTemplate: "{number}",
            },
          }),
          expected: "{actor}/{number}",
        },
      ];

      for (const { raw, expected } of cases) {
        const { parsed } = migrate(raw);
        expect((raw.naming as Record<string, unknown>).folderTemplate).toBe(expected);

        if (expected === "{actor}") {
          expect(parsed.naming.assetNamingMode).toBe("followVideo");
          expect(parsed.download.nfoNaming).toBe("filename");
          expect(parsed.download.downloadSceneImages).toBe(false);
          expect(parsed.download.keepSceneImages).toBe(false);
        }

        if (expected === "/{title}") {
          expect(parsed.naming.assetNamingMode).toBe("fixed");
          expect(parsed.download.nfoNaming).toBe("both");
          expect(parsed.download.downloadSceneImages).toBe(true);
        }

        if (expected === "/{originaltitle}") {
          expect(parsed.naming.assetNamingMode).toBe("fixed");
          expect(parsed.download.nfoNaming).toBe("both");
          expect(parsed.download.downloadSceneImages).toBe(true);
        }
      }
    });
  });

  describe("v0.4.0 → v0.5.0", () => {
    it("renames v0.4 keys and upgrades untouched defaults", () => {
      const { raw, result, parsed } = migrate(buildV040Config());
      const download = raw.download as Record<string, unknown>;
      const scrape = raw.scrape as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, unknown>;

      expect(result).toEqual({
        migrated: true,
        fromVersion: 1,
        toVersion: 4,
        applied: ["v0.4.0 → v0.5.0", "v0.5.0 → v0.5.2", "v0.5.2 → v0.6.0"],
      });

      expect(download.generateNfo).toBe(true);
      expect(download).not.toHaveProperty("downloadNfo");
      expect(scrape.enabledSites).toEqual(V050_ENABLED_SITES);
      expect(scrape.siteOrder).toEqual(V050_ENABLED_SITES);
      expect(fieldPriorities.title).toEqual(V052_FIELD_PRIORITY_DEFAULTS.title);
      expect(fieldPriorities.scene_images).toEqual(V050_FIELD_PRIORITY_DEFAULTS.scene_images);
      expect(fieldPriorities).not.toHaveProperty("sample_images");
      expect(parsed.aggregation.fieldPriorities.title).toEqual(V052_FIELD_PRIORITY_DEFAULTS.title);
      expect(parsed.naming.partStyle).toBe("RAW");
    });

    it("preserves customized v0.4 values while renaming fields", () => {
      const raw = buildV040Config();
      const scrape = raw.scrape as Record<string, unknown>;
      const download = raw.download as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, string[]>;
      const naming = raw.naming as Record<string, unknown>;

      scrape.enabledSites = ["avbase", "javdb"];
      scrape.siteOrder = ["javdb", "avbase"];
      download.downloadNfo = false;
      fieldPriorities.sample_images = ["javbus"];
      fieldPriorities.rating = ["javdb"];
      naming.partStyle = "disc";

      const parsed = migrate(raw).parsed;

      expect(parsed.download.generateNfo).toBe(false);
      expect(parsed.naming.partStyle).toBe("DISC");
      expect(parsed.aggregation.fieldPriorities.scene_images).toEqual(["javbus"]);
      expect(parsed.aggregation.fieldPriorities.rating).toEqual(["javdb"]);
    });
  });

  describe("v0.5.0 → v0.6.0", () => {
    function buildV050Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        configVersion: 2,
        aggregation: {
          fieldPriorities: {
            title: [...V050_FIELD_PRIORITY_DEFAULTS.title],
          },
        },
        translate: {
          enableTranslation: false,
          engine: "openai",
          llmModelName: "gpt-5.2",
          llmApiKey: "",
          llmBaseUrl: "",
          llmPrompt: "请将以下文本翻译成{lang}。只输出翻译结果。\\n{content}",
          llmTemperature: 1.0,
          llmMaxTry: 3,
          llmMaxRequestsPerSecond: 1,
          enableGoogleFallback: true,
          titleLanguage: "zh-CN",
          plotLanguage: "zh-CN",
        },
        ...overrides,
      };
    }

    it("renames translate fields and removes obsolete ones", () => {
      const { raw, result, parsed } = migrate(buildV050Config());
      const translate = raw.translate as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, unknown>;

      expect(result).toEqual({
        migrated: true,
        fromVersion: 2,
        toVersion: 4,
        applied: ["v0.5.0 → v0.5.2", "v0.5.2 → v0.6.0"],
      });

      expect(translate.llmMaxRetries).toBe(3);
      expect(translate).not.toHaveProperty("llmMaxTry");
      expect(translate.targetLanguage).toBe("zh-CN");
      expect(translate.llmBaseUrl).toBe(DEFAULT_LLM_BASE_URL);
      expect(translate).not.toHaveProperty("titleLanguage");
      expect(translate).not.toHaveProperty("plotLanguage");
      expect(translate).not.toHaveProperty("enableGoogleFallback");
      expect(translate.llmPrompt).toBe("自动识别原文语言，将以下内容翻译为{lang}。只输出最终翻译结果。\\n{content}");
      expect(fieldPriorities.title).toEqual(V052_FIELD_PRIORITY_DEFAULTS.title);
      expect(parsed.translate.llmMaxRetries).toBe(3);
      expect(parsed.translate.targetLanguage).toBe("zh-CN");
      expect(parsed.translate.llmBaseUrl).toBe(DEFAULT_LLM_BASE_URL);
      expect(parsed.translate.llmPrompt).toBe(
        "自动识别原文语言，将以下内容翻译为{lang}。只输出最终翻译结果。\\n{content}",
      );
      expect(parsed.aggregation.fieldPriorities.title).toEqual(V052_FIELD_PRIORITY_DEFAULTS.title);
    });

    it("preserves customized titleLanguage as targetLanguage", () => {
      const raw = buildV050Config({
        translate: {
          enableTranslation: true,
          engine: "openai",
          llmApiKey: "key",
          llmMaxTry: 5,
          titleLanguage: "zh-TW",
          plotLanguage: "zh-CN",
          enableGoogleFallback: false,
        },
      });

      const parsed = migrate(raw).parsed;

      expect(parsed.translate.targetLanguage).toBe("zh-TW");
      expect(parsed.translate.llmMaxRetries).toBe(5);
    });

    it("preserves customized llmPrompt instead of resetting it", () => {
      const parsed = migrate(
        buildV050Config({
          translate: {
            llmPrompt: "自定义提示词：{lang}\\n{content}",
          },
        }),
      ).parsed;

      expect(parsed.translate.llmPrompt).toBe("自定义提示词：{lang}\\n{content}");
    });

    it("preserves customized title priority instead of resetting it", () => {
      const parsed = migrate(
        buildV050Config({
          aggregation: {
            fieldPriorities: {
              title: ["fc2", "javdb", "fc2hub"],
            },
          },
        }),
      ).parsed;

      expect(parsed.aggregation.fieldPriorities.title).toEqual(["fc2", "javdb", "fc2hub"]);
    });
  });

  describe("migrator behavior", () => {
    it("skips migration for current version", () => {
      const raw = configurationSchema.parse({}) as unknown as Record<string, unknown>;

      const result = runMigrations(raw);

      expect(result).toEqual({
        migrated: false,
        fromVersion: CURRENT_CONFIG_VERSION,
        toVersion: CURRENT_CONFIG_VERSION,
        applied: [],
      });
    });

    it("stamps configVersion and returns migration metadata", () => {
      const { raw, result } = migrate();

      expect(raw.configVersion).toBe(CURRENT_CONFIG_VERSION);
      expect(result).toEqual({
        migrated: true,
        fromVersion: 0,
        toVersion: CURRENT_CONFIG_VERSION,
        applied: ["v0.3.0 → v0.4.0", "v0.4.0 → v0.5.0", "v0.5.0 → v0.5.2", "v0.5.2 → v0.6.0"],
      });
    });

    it("rejects config versions newer than the current app supports", () => {
      const raw = buildV040Config();
      raw.configVersion = 99;

      expect(() => runMigrations(raw)).toThrow(ConfigMigrationError);
      expect(() => runMigrations(raw)).toThrow("newer than supported version");
    });

    it("migrated v0.3.0 config passes Zod schema validation", () => {
      const { raw } = migrate();
      expect(configurationSchema.safeParse(raw).success).toBe(true);
    });
  });
});
