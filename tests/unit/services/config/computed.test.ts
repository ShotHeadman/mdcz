import type { MediaLibraryRecord } from "@mdcz/persistence";
import { buildComputedConfiguration } from "@mdcz/runtime/config";
import { findNamingPolicy } from "@mdcz/runtime/library";
import { buildCrawlerOptions } from "@mdcz/runtime/scrape";
import { configurationSchema } from "@mdcz/shared/config";
import { ProxyType, Website } from "@mdcz/shared/enums";
import { mediaLibrarySettingsSchema, type NamingPolicy, resolveMovieNaming } from "@mdcz/shared/mediaLibrary";
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

  it("names a movie's files by its library unless the movie shares a folder with other movies", () => {
    const library = (placement: NamingPolicy["placement"], folderTemplate: string): NamingPolicy => ({
      placement,
      folderTemplate,
      assetNaming: "fixed",
      nfoNaming: "movie",
    });
    const shared = { sharedFolder: true, assetNaming: "followVideo", nfoNaming: "filename", sceneImages: false };
    for (const [policy, holdsOtherMovies, expected] of [
      [library("move", "{actor}/{number}"), false, { sharedFolder: false, assetNaming: "fixed", nfoNaming: "movie" }],
      [library("move", "{actor}"), false, shared],
      [library("move", ""), false, shared],
      // The policy, not the in-place write that maintenance makes, says the folder is shared by template.
      [library("metadataOnly", "{actor}"), false, shared],
      // An in-place library has no template; its folders are shared when they hold other movies.
      [library("inPlace", "{actor}"), false, { sharedFolder: false, nfoNaming: "movie", sceneImages: true }],
      [library("inPlace", ""), true, shared],
      // Any folder of the movie that holds another movie decides for all of them.
      [library("move", "{actor}/{number}"), true, shared],
      [undefined, false, { sharedFolder: false, assetNaming: "fixed", nfoNaming: "both", sceneImages: true }],
      [undefined, true, shared],
    ] as const) {
      expect(resolveMovieNaming({ policy, holdsOtherMovies, downloadSceneImages: true })).toMatchObject(expected);
    }
    expect(
      resolveMovieNaming({ policy: library("move", "{number}"), holdsOtherMovies: false, downloadSceneImages: false })
        .sceneImages,
    ).toBe(false);
  });

  it("takes a path's naming policy from the closest library and refuses libraries that disagree", () => {
    const record = (
      name: string,
      settings: Partial<Pick<MediaLibraryRecord, "sourcePath" | "outputPath" | "folderTemplate" | "nfoNaming">>,
    ): MediaLibraryRecord => ({
      id: name,
      name,
      sourcePath: `/sources/${name}`,
      outputPath: "",
      folderTemplate: "{actor}/{number}",
      fileTemplate: "{number}",
      placement: "move",
      assetNaming: "fixed",
      nfoNaming: "both",
      automation: "off",
      discovery: "events",
      cloudPath: "",
      scanIntervalMinutes: 15,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...settings,
    });
    const libraries = [
      record("outer", { outputPath: "/out", nfoNaming: "movie" }),
      record("inner", { outputPath: "/out/inner", nfoNaming: "filename" }),
      record("twinA", { outputPath: "/shared" }),
      record("twinB", { outputPath: "/shared" }),
      // Different stored values, yet both templates share folders, so both name files the same way.
      record("actorA", { outputPath: "/actors", folderTemplate: "{actor}", nfoNaming: "movie" }),
      record("actorB", { outputPath: "/actors", folderTemplate: "{actor}" }),
    ];
    for (const [path, nfoNaming] of [
      ["/sources/outer/ABC-1.mp4", "movie"],
      ["/out/X/ABC-1.nfo", "movie"],
      ["/out/inner/X/ABC-1.nfo", "filename"],
      ["/shared/X/ABC-1.nfo", "both"],
      ["/actors/X/ABC-1.nfo", "movie"],
      ["/elsewhere/ABC-1.mp4", undefined],
    ] as const) {
      expect(findNamingPolicy(libraries, path)?.nfoNaming).toBe(nfoNaming);
    }
    expect(() =>
      findNamingPolicy([...libraries, record("rival", { outputPath: "/shared", nfoNaming: "movie" })], "/shared/X"),
    ).toThrow('"twinA" and "twinB" and "rival"');
  });

  it("rejects invalid overview sources and Jellyfin userId", () => {
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
