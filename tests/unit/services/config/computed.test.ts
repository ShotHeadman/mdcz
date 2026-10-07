import { buildComputedConfiguration } from "@main/services/config/computed";
import { buildCrawlerOptions } from "@mdcz/runtime/scrape";
import { assertTargetLayout } from "@mdcz/runtime/scrape/FileOrganizer";
import { configurationSchema } from "@mdcz/shared/config";
import { ProxyType, Website } from "@mdcz/shared/enums";
import { mediaLibrarySettingsSchema } from "@mdcz/shared/mediaLibrary";
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

  it("enforces shared-directory library layouts, overview sources, and Jellyfin userId", () => {
    const sharedDirectory = {
      placement: "move",
      outputPath: "/out",
      folderTemplate: "{actor}",
      fileTemplate: "{number}",
    } as const;
    const valid = { assetNamingMode: "followVideo", nfoNaming: "filename", downloadSceneImages: false };
    for (const [override, message] of [
      [{}, undefined],
      [{ assetNamingMode: "fixed" }, "asset naming"],
      [{ nfoNaming: "movie" }, "NFO naming"],
      [{ downloadSceneImages: true }, "scene images"],
    ] as const) {
      const { assetNamingMode, ...download } = { ...valid, ...override };
      const configuration = configurationSchema.parse({ naming: { assetNamingMode }, download });
      if (message) expect(() => assertTargetLayout(configuration, sharedDirectory)).toThrow(message);
      else expect(() => assertTargetLayout(configuration, sharedDirectory)).not.toThrow();
    }

    const cases = [
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
        message: "jellyfinUserIdNotUuid",
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

  it("validates library settings: output placement, overlap, path-spanning optional groups, and cloud paths", () => {
    const library = {
      name: "Library",
      sourcePath: "/media/downloads",
      outputPath: "/media/library",
      placement: "hardlink",
    };
    expect(mediaLibrarySettingsSchema.safeParse(library).success).toBe(true);
    for (const [override, path, message] of [
      [{ outputPath: "" }, "outputPath", "libraryOutputRequired"],
      [{ placement: "symlink", outputPath: "/media/downloads/library" }, "outputPath", "libraryOutputOverlapsSource"],
      [{ folderTemplate: "{actor}[/{series}]/{number}" }, "folderTemplate", "optionalSegmentPathSeparator"],
      [{ fileTemplate: "[\\{series}]{number}" }, "fileTemplate", "optionalSegmentPathSeparator"],
      [{ discovery: "clouddrive", cloudPath: "/" }, "cloudPath", "libraryCloudPathInvalid"],
    ] as const) {
      const result = mediaLibrarySettingsSchema.safeParse({ ...library, ...override });
      expect(result.error?.issues).toEqual([expect.objectContaining({ path: [path], message })]);
    }
  });
});
