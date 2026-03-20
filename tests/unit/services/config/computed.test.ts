import { buildComputedConfiguration } from "@main/services/config/computed";
import { configurationSchema } from "@main/services/config/models";
import { ProxyType, Website } from "@shared/enums";
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

  it("enforces schema rules for folderTemplate, overview sources, and Jellyfin userId", () => {
    const cases = [
      {
        result: configurationSchema.safeParse({
          naming: {
            folderTemplate: "{actor}",
          },
          behavior: {
            successFileMove: true,
          },
        }),
        path: ["naming", "folderTemplate"],
        message: "开启成功后移动文件时，文件夹模板必须包含 {number}",
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

  it("keeps actor photo defaults under paths and ignores legacy personSync.actorPhotoFolder", () => {
    const defaultConfiguration = configurationSchema.parse({});
    expect(defaultConfiguration.paths.actorPhotoFolder).toBe("actor_photo");
    expect(defaultConfiguration.aggregation.fieldPriorities.durationSeconds).toEqual([
      Website.AVBASE,
      Website.DMM_TV,
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
      Website.FC2,
      Website.FC2HUB,
      Website.JAVDB,
      Website.JAVBUS,
    ]);
    expect(defaultConfiguration.aggregation.fieldPriorities.publisher).toEqual([
      Website.AVBASE,
      Website.DMM,
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

    expect(legacyConfiguration.paths.actorPhotoFolder).toBe("actor_photo");
    expect(legacyConfiguration.personSync).not.toHaveProperty("actorPhotoFolder");
  });
});
