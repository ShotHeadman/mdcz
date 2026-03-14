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
        actor_profiles: ["javdb", "mgstage", "dmm"],
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

describe("Configuration migrations", () => {
  describe("v0.3.0 → v0.4.0", () => {
    it("renames download.downloadCover → downloadThumb", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const download = raw.download as Record<string, unknown>;
      expect(download.downloadThumb).toBe(true);
      expect(download).not.toHaveProperty("downloadCover");
    });

    it("renames download.keepCover → keepThumb", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const download = raw.download as Record<string, unknown>;
      expect(download.keepThumb).toBe(false); // was set to false in fixture
      expect(download).not.toHaveProperty("keepCover");
    });

    it("splits server into emby and moves actorPhotoFolder to paths", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      // server should be deleted
      expect(raw).not.toHaveProperty("server");

      // emby should have server's values
      const emby = raw.emby as Record<string, unknown>;
      expect(emby.url).toBe("http://192.168.1.100:8096");
      expect(emby.apiKey).toBe("my-api-key");
      expect(emby.userId).toBe("");

      // jellyfin should remain untouched so current defaults can fill it
      expect(raw).not.toHaveProperty("jellyfin");

      // actorPhotoFolder should be moved to paths
      const paths = raw.paths as Record<string, unknown>;
      expect(paths.actorPhotoFolder).toBe("/photos");
    });

    it("sets actorPhotoFolder to 'actor_photo' when server.actorPhotoFolder is empty", () => {
      const raw = buildV030Config({
        server: { url: "", apiKey: "", userId: "", actorPhotoFolder: "" },
      });
      runMigrations(raw);

      const paths = raw.paths as Record<string, unknown>;
      expect(paths.actorPhotoFolder).toBe("actor_photo");
    });

    it("renames fieldPriorities.cover_url → thumb_url", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const fp = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, unknown>;
      expect(fp.thumb_url).toEqual(defaultConfiguration.aggregation.fieldPriorities.thumb_url);
      expect(fp).not.toHaveProperty("cover_url");
    });

    it("changes sceneImagesFolder from 'samples' to 'extrafanart'", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const paths = raw.paths as Record<string, unknown>;
      expect(paths.sceneImagesFolder).toBe("extrafanart");
    });

    it("preserves custom sceneImagesFolder when not 'samples'", () => {
      const raw = buildV030Config({
        paths: {
          mediaPath: "/media",
          softlinkPath: "softlink",
          successOutputFolder: "JAV_output",
          failedOutputFolder: "failed",
          sceneImagesFolder: "my_custom_folder",
          configDirectory: "config",
        },
      });
      runMigrations(raw);

      const paths = raw.paths as Record<string, unknown>;
      expect(paths.sceneImagesFolder).toBe("my_custom_folder");
    });

    it("appends avbase to enabledSites and siteOrder", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const scrape = raw.scrape as Record<string, unknown>;
      expect(scrape.enabledSites).toContain("km_produce");
      expect(scrape.enabledSites).toContain("avbase");
      expect(scrape.siteOrder).toContain("km_produce");
      expect(scrape.siteOrder).toContain("avbase");
    });

    it("normalizes legacy fieldPriorities defaults to the current defaults", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const parsed = configurationSchema.parse(raw);
      expect(parsed.aggregation.fieldPriorities).toEqual(defaultConfiguration.aggregation.fieldPriorities);
    });

    it("preserves customized fieldPriorities arrays", () => {
      const raw = buildV030Config();
      const fp = (raw.aggregation as Record<string, unknown>).fieldPriorities as Record<string, string[]>;
      fp.title = ["javdb", "dmm"];
      fp.rating = ["javdb"];

      runMigrations(raw);

      const parsed = configurationSchema.parse(raw);
      expect(parsed.aggregation.fieldPriorities.title).toEqual(["javdb", "dmm"]);
      expect(parsed.aggregation.fieldPriorities.rating).toEqual(["javdb"]);
    });

    it("does not duplicate sites if already present", () => {
      const raw = buildV030Config();
      // Manually add avbase to enabledSites
      (raw.scrape as Record<string, unknown>).enabledSites = ["dmm", "avbase"];
      runMigrations(raw);

      const scrape = raw.scrape as Record<string, unknown>;
      const sites = scrape.enabledSites as string[];
      expect(sites.filter((s) => s === "avbase")).toHaveLength(1);
      expect(sites).not.toContain("km_produce");
    });

    it("fixes folderTemplate when successFileMove is enabled and {number} is missing", () => {
      const raw = buildV030Config({
        naming: {
          folderTemplate: "{actor}",
          fileTemplate: "{number}",
        },
      });

      runMigrations(raw);

      expect((raw.naming as Record<string, unknown>).folderTemplate).toBe("{actor}/{number}");
    });

    it("preserves folderTemplate when successFileMove is disabled", () => {
      const raw = buildV030Config({
        naming: {
          folderTemplate: "{actor}",
          fileTemplate: "{number}",
        },
        behavior: {
          successFileMove: false,
        },
      });

      runMigrations(raw);

      expect((raw.naming as Record<string, unknown>).folderTemplate).toBe("{actor}");
    });
  });

  describe("migrator behavior", () => {
    it("skips migration for current version", () => {
      const raw = buildV030Config();
      raw.configVersion = 1; // already at latest
      // Remove v0.3.0 fields that won't exist after migrating to v0.4.0
      delete (raw.download as Record<string, unknown>).downloadCover;
      delete (raw.download as Record<string, unknown>).keepCover;
      delete raw.server;
      (raw.download as Record<string, unknown>).downloadThumb = true;
      (raw.download as Record<string, unknown>).keepThumb = true;
      raw.emby = { url: "http://192.168.1.100:8096", apiKey: "my-api-key", userId: "" };

      const result = runMigrations(raw);
      expect(result.migrated).toBe(false);
      expect(result.applied).toHaveLength(0);
    });

    it("stamps configVersion after migration", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      expect(raw.configVersion).toBe(1);
    });

    it("returns migration metadata", () => {
      const raw = buildV030Config();
      const result = runMigrations(raw);

      expect(result.migrated).toBe(true);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(1);
      expect(result.applied).toEqual(["v0.3.0 → v0.4.0"]);
    });

    it("rejects config versions newer than the current app supports", () => {
      const raw = buildV030Config();
      raw.configVersion = 99;

      expect(() => runMigrations(raw)).toThrow(ConfigMigrationError);
      expect(() => runMigrations(raw)).toThrow("newer than supported version");
    });

    it("migrated v0.3.0 config passes Zod schema validation", () => {
      const raw = buildV030Config();
      runMigrations(raw);

      const parsed = configurationSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
    });
  });
});
