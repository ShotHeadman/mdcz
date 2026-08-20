import { buildComputedConfiguration } from "@main/services/config/computed";
import { buildCrawlerOptions } from "@mdcz/runtime/scrape";
import { configurationSchema } from "@mdcz/shared/config";
import { ProxyType, Website } from "@mdcz/shared/enums";
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
});
