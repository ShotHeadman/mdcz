import { ConfigMigrationError, runMigrations } from "@main/services/config/migrator";
import { configurationSchema, defaultConfiguration } from "@main/services/config/models";
import { describe, expect, it } from "vitest";

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
      enabledSites: [
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
      ],
      siteOrder: [
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
      ],
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
        scene_images: ["mgstage", "dmm", "javbus", "javdb"],
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

const migrate = (raw = buildV030Config()) => {
  const result = runMigrations(raw);
  return {
    raw,
    result,
    parsed: configurationSchema.parse(raw),
  };
};

describe("Configuration migrations", () => {
  describe("v0.3.0 → v0.4.0", () => {
    it("renames and relocates legacy fields", () => {
      const { raw } = migrate();

      const download = raw.download as Record<string, unknown>;
      const paths = raw.paths as Record<string, unknown>;
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, unknown>;

      expect(download.downloadThumb).toBe(true);
      expect(download.keepThumb).toBe(false);
      expect(download).not.toHaveProperty("downloadCover");
      expect(download).not.toHaveProperty("keepCover");

      expect(raw).not.toHaveProperty("server");
      expect(raw.emby).toEqual({
        url: "http://192.168.1.100:8096",
        apiKey: "my-api-key",
        userId: "",
      });
      expect(raw).not.toHaveProperty("jellyfin");
      expect(paths.actorPhotoFolder).toBe("/photos");

      expect(fieldPriorities.thumb_url).toEqual(defaultConfiguration.aggregation.fieldPriorities.thumb_url);
      expect(fieldPriorities).not.toHaveProperty("cover_url");
    });

    it("normalizes legacy defaults to the current defaults", () => {
      const { raw, parsed } = migrate();
      const paths = raw.paths as Record<string, unknown>;
      const scrape = raw.scrape as Record<string, unknown>;

      expect(paths.sceneImagesFolder).toBe("extrafanart");
      expect(scrape.enabledSites).toEqual(defaultConfiguration.scrape.enabledSites);
      expect(scrape.siteOrder).toEqual(defaultConfiguration.scrape.siteOrder);
      expect(parsed.aggregation.fieldPriorities.actors).toEqual(
        defaultConfiguration.aggregation.fieldPriorities.actors,
      );
      expect(parsed.aggregation.fieldPriorities.thumb_url).toEqual(
        defaultConfiguration.aggregation.fieldPriorities.thumb_url,
      );
      expect(parsed.aggregation.fieldPriorities.poster_url).toEqual(
        defaultConfiguration.aggregation.fieldPriorities.poster_url,
      );
      expect(parsed.aggregation.fieldPriorities.release_date).toEqual(
        defaultConfiguration.aggregation.fieldPriorities.release_date,
      );
    });

    it("preserves customized values instead of resetting them", () => {
      const raw = buildV030Config({
        scrape: {
          enabledSites: ["dmm"],
          siteOrder: ["dmm"],
        },
        server: { url: "", apiKey: "", userId: "", actorPhotoFolder: "" },
        paths: {
          mediaPath: "/media",
          softlinkPath: "softlink",
          successOutputFolder: "JAV_output",
          failedOutputFolder: "failed",
          sceneImagesFolder: "my_custom_folder",
          configDirectory: "config",
        },
      });
      const fieldPriorities = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, string[]>;
      fieldPriorities.title = ["javdb", "dmm"];
      fieldPriorities.rating = ["javdb"];

      const parsed = migrate(raw).parsed;

      expect(parsed.scrape.enabledSites).toEqual(["dmm"]);
      expect(parsed.scrape.siteOrder).toEqual(["dmm"]);
      expect(parsed.paths.sceneImagesFolder).toBe("my_custom_folder");
      expect(parsed.paths.actorPhotoFolder).toBe("actor_photo");
      expect(parsed.aggregation.fieldPriorities.title).toEqual(["javdb", "dmm"]);
      expect(parsed.aggregation.fieldPriorities.rating).toEqual(["javdb"]);
    });

    it("updates folderTemplate only when successFileMove requires {number}", () => {
      const cases = [
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "{actor}",
              fileTemplate: "{number}",
            },
          }),
          expected: "{actor}/{number}",
        },
        {
          raw: buildV030Config({
            naming: {
              folderTemplate: "{actor}",
              fileTemplate: "{number}",
            },
            behavior: {
              successFileMove: false,
            },
          }),
          expected: "{actor}",
        },
      ];

      for (const { raw, expected } of cases) {
        migrate(raw);
        expect((raw.naming as Record<string, unknown>).folderTemplate).toBe(expected);
      }
    });
  });

  describe("migrator behavior", () => {
    it("skips migration for current version", () => {
      const raw = buildV030Config();
      raw.configVersion = 2;
      delete (raw.download as Record<string, unknown>).downloadCover;
      delete (raw.download as Record<string, unknown>).keepCover;
      delete raw.server;
      (raw.download as Record<string, unknown>).downloadThumb = true;
      (raw.download as Record<string, unknown>).keepThumb = true;
      raw.emby = { url: "http://192.168.1.100:8096", apiKey: "my-api-key", userId: "" };

      const result = runMigrations(raw);

      expect(result).toEqual({
        migrated: false,
        fromVersion: 2,
        toVersion: 2,
        applied: [],
      });
    });

    it("stamps configVersion and returns migration metadata", () => {
      const { raw, result } = migrate();

      expect(raw.configVersion).toBe(2);
      expect(result).toEqual({
        migrated: true,
        fromVersion: 0,
        toVersion: 2,
        applied: ["v0.3.0 → v0.4.0", "v0.4.0 → v0.4.1"],
      });
    });

    it("rejects config versions newer than the current app supports", () => {
      const raw = buildV030Config();
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
