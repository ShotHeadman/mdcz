import { buildComputedConfiguration } from "@main/services/config/computed";
import { configurationSchema } from "@main/services/config/models";
import { buildCrawlerOptions } from "@main/services/scraper/crawlerOptions";
import { ProxyType, Website } from "@mdcz/shared/enums";
import { DEFAULT_POSTER_TAG_BADGE_TYPES, POSTER_TAG_BADGE_TYPE_OPTIONS } from "@mdcz/shared/posterBadges";
import { DEFAULT_R18_METADATA_LANGUAGE } from "@mdcz/shared/r18";
import { describe, expect, it } from "vitest";

describe("buildComputedConfiguration", () => {
  it("normalizes proxy settings for omitted protocols, explicit protocols, and disabled proxies", () => {
    const cases = [
      {
        configuration: configurationSchema.parse({
          network: {
            useProxy: true,
            proxyType: ProxyType.SOCKS5,
            proxy: "127.0.0.1:7890",
          },
        }),
        expected: "socks5://127.0.0.1:7890",
      },
      {
        configuration: configurationSchema.parse({
          network: {
            useProxy: true,
            proxyType: ProxyType.HTTP,
            proxy: "https://127.0.0.1:7890",
          },
        }),
        expected: "https://127.0.0.1:7890",
      },
      {
        configuration: configurationSchema.parse({
          network: {
            useProxy: true,
            proxyType: ProxyType.NONE,
            proxy: "127.0.0.1:7890",
          },
        }),
        expected: undefined,
      },
    ];

    for (const { configuration, expected } of cases) {
      expect(buildComputedConfiguration(configuration).proxyUrl).toBe(expected);
    }
  });

  it("exports timeout and retry settings", () => {
    const configuration = configurationSchema.parse({
      network: {
        timeout: 25,
        retryCount: 4,
      },
    });

    const computed = buildComputedConfiguration(configuration);
    expect(computed.networkTimeoutMs).toBe(25_000);
    expect(computed.networkRetryCount).toBe(4);
  });

  it("defaults and forwards the R18.dev metadata language preference", () => {
    const defaults = configurationSchema.parse({});
    const customized = configurationSchema.parse({
      scrape: {
        r18MetadataLanguage: "en",
      },
    });

    expect(defaults.scrape.r18MetadataLanguage).toBe(DEFAULT_R18_METADATA_LANGUAGE);
    expect(buildCrawlerOptions({ site: Website.R18_DEV, configuration: defaults }).r18MetadataLanguage).toBe("ja");
    expect(buildCrawlerOptions({ site: Website.R18_DEV, configuration: customized }).r18MetadataLanguage).toBe("en");
    expect(
      buildCrawlerOptions({ site: Website.AVBASE, configuration: customized }).r18MetadataLanguage,
    ).toBeUndefined();
  });

  it("fills poster badge settings defaults and preserves explicit badge filters", () => {
    const defaults = configurationSchema.parse({});
    const customized = configurationSchema.parse({
      download: {
        tagBadgeTypes: ["subtitle", "leak"],
        tagBadgePosition: "bottomRight",
      },
    });

    expect(defaults.download.tagBadgeTypes).toEqual([...DEFAULT_POSTER_TAG_BADGE_TYPES]);
    expect(defaults.download.tagBadgeTypes).not.toEqual([...POSTER_TAG_BADGE_TYPE_OPTIONS]);
    expect(defaults.download.tagBadgePosition).toBe("topLeft");
    expect(defaults.download.tagBadgeImageOverrides).toBe(false);
    expect(customized.download.tagBadgeTypes).toEqual(["subtitle", "leak"]);
    expect(customized.download.tagBadgePosition).toBe("bottomRight");
  });

  it("enforces shared-directory rules, overview sources, and Jellyfin userId", () => {
    const cases = [
      {
        result: configurationSchema.safeParse({
          naming: {
            folderTemplate: "{actor}",
            assetNamingMode: "fixed",
          },
          behavior: {
            successFileMove: true,
          },
          download: {
            nfoNaming: "filename",
            downloadSceneImages: false,
          },
        }),
        path: ["naming", "assetNamingMode"],
        message: "共享目录模式下，附属文件命名必须使用“跟随影片文件名”",
      },
      {
        result: configurationSchema.safeParse({
          naming: {
            folderTemplate: "{actor}",
            assetNamingMode: "followVideo",
          },
          behavior: {
            successFileMove: true,
          },
          download: {
            nfoNaming: "movie",
            downloadSceneImages: false,
          },
        }),
        path: ["download", "nfoNaming"],
        message: "共享目录模式下，NFO 文件命名必须使用“仅 文件名.nfo”",
      },
      {
        result: configurationSchema.safeParse({
          naming: {
            folderTemplate: "{actor}",
            assetNamingMode: "followVideo",
          },
          behavior: {
            successFileMove: true,
          },
          download: {
            nfoNaming: "filename",
            downloadSceneImages: true,
          },
        }),
        path: ["download", "downloadSceneImages"],
        message: "共享目录模式下不支持下载剧照，请关闭“下载剧照”",
      },
      {
        result: configurationSchema.safeParse({
          personSync: {
            personOverviewSources: ["official", "local"],
          },
        }),
        path: undefined,
        message: undefined,
      },
      {
        result: configurationSchema.safeParse({
          jellyfin: {
            userId: "not-a-uuid",
          },
        }),
        path: ["jellyfin", "userId"],
        message: "Jellyfin 用户 ID 必须为 UUID，留空则按服务端默认处理",
      },
    ];

    for (const { result, path, message } of cases) {
      expect(result.success).toBe(false);
      if (result.success) {
        continue;
      }

      if (path && message) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path,
              message,
            }),
          ]),
        );
      }
    }
  });

  it("allows shared-directory templates when companion naming rules are satisfied", () => {
    const result = configurationSchema.safeParse({
      naming: {
        folderTemplate: "{actor}",
        assetNamingMode: "followVideo",
      },
      behavior: {
        successFileMove: true,
      },
      download: {
        nfoNaming: "filename",
        downloadSceneImages: false,
      },
    });

    expect(result.success).toBe(true);
  });

  it("treats title-based folder templates as dedicated movie directories", () => {
    const result = configurationSchema.safeParse({
      naming: {
        folderTemplate: "/{title}",
        assetNamingMode: "fixed",
      },
      behavior: {
        successFileMove: true,
      },
      download: {
        nfoNaming: "both",
        downloadSceneImages: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it("treats original-title-based folder templates as dedicated movie directories", () => {
    const result = configurationSchema.safeParse({
      naming: {
        folderTemplate: "/{originaltitle}",
        assetNamingMode: "fixed",
      },
      behavior: {
        successFileMove: true,
      },
      download: {
        nfoNaming: "both",
        downloadSceneImages: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects optional groups that try to span multiple path segments", () => {
    const cases = [
      {
        result: configurationSchema.safeParse({
          naming: {
            folderTemplate: "{actor}[/{series}]/{number}",
          },
        }),
        path: ["naming", "folderTemplate"],
      },
      {
        result: configurationSchema.safeParse({
          naming: {
            fileTemplate: "[\\{series}]{number}",
          },
        }),
        path: ["naming", "fileTemplate"],
      },
    ];

    for (const { result, path } of cases) {
      expect(result.success).toBe(false);
      if (result.success) {
        continue;
      }

      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path,
            message: "[] 可选段不能包含路径分隔符，请仅在单个路径片段内使用可选内容",
          }),
        ]),
      );
    }
  });

  it("keeps actor photo defaults empty under paths and ignores legacy personSync.actorPhotoFolder", () => {
    const defaultConfiguration = configurationSchema.parse({});
    expect(defaultConfiguration.paths.actorPhotoFolder).toBe("");
    expect(defaultConfiguration.aggregation.fieldPriorities.durationSeconds).toEqual([
      Website.AVBASE,
      Website.DMM_TV,
      Website.AVWIKIDB,
      Website.FC2HUB,
    ]);
    expect(defaultConfiguration.aggregation.fieldPriorities.rating).toEqual([
      Website.DMM_TV,
      Website.DMM,
      Website.FC2HUB,
      Website.JAVDB,
    ]);
    expect(defaultConfiguration.aggregation.fieldPriorities.studio).toEqual([
      Website.AVBASE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]);
    expect(defaultConfiguration.aggregation.fieldPriorities.publisher).toEqual([
      Website.AVBASE,
      Website.DMM,
      Website.AVWIKIDB,
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
    ]);
    expect(defaultConfiguration.aggregation.fieldPriorities.trailer_url).not.toContain(Website.AVBASE);

    const legacyConfiguration = configurationSchema.parse({
      personSync: {
        actorPhotoFolder: "/legacy/actor-library",
        personOverviewSources: ["official"],
        personImageSources: ["local", "official"],
      },
    });

    expect(legacyConfiguration.paths.actorPhotoFolder).toBe("");
    expect(legacyConfiguration.personSync).not.toHaveProperty("actorPhotoFolder");
  });
});
