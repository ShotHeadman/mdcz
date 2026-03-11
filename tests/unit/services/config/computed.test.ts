import { buildComputedConfiguration } from "@main/services/config/computed";
import { configurationSchema } from "@main/services/config/models";
import { ProxyType } from "@shared/enums";
import { describe, expect, it } from "vitest";

describe("buildComputedConfiguration", () => {
  it("builds proxy url from proxyType when protocol is omitted", () => {
    const configuration = configurationSchema.parse({
      network: {
        useProxy: true,
        proxyType: ProxyType.SOCKS5,
        proxy: "127.0.0.1:7890",
      },
    });

    const computed = buildComputedConfiguration(configuration);
    expect(computed.proxyUrl).toBe("socks5://127.0.0.1:7890");
  });

  it("preserves explicitly provided proxy protocol", () => {
    const configuration = configurationSchema.parse({
      network: {
        useProxy: true,
        proxyType: ProxyType.HTTP,
        proxy: "https://127.0.0.1:7890",
      },
    });

    const computed = buildComputedConfiguration(configuration);
    expect(computed.proxyUrl).toBe("https://127.0.0.1:7890");
  });

  it("disables proxy when proxyType is none", () => {
    const configuration = configurationSchema.parse({
      network: {
        useProxy: true,
        proxyType: ProxyType.NONE,
        proxy: "127.0.0.1:7890",
      },
    });

    const computed = buildComputedConfiguration(configuration);
    expect(computed.proxyUrl).toBeUndefined();
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

  it("requires folderTemplate to include {number} when successFileMove is enabled", () => {
    const result = configurationSchema.safeParse({
      naming: {
        folderTemplate: "{actor}",
      },
      behavior: {
        successFileMove: true,
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["naming", "folderTemplate"],
          message: "开启成功后移动文件时，文件夹模板必须包含 {number}",
        }),
      ]),
    );
  });

  it("rejects local as a person overview source", () => {
    const result = configurationSchema.safeParse({
      personSync: {
        personOverviewSources: ["official", "local"],
      },
    });

    expect(result.success).toBe(false);
  });

  it("uses actor_photo as the default actor photo folder under paths", () => {
    const configuration = configurationSchema.parse({});

    expect(configuration.paths.actorPhotoFolder).toBe("actor_photo");
  });

  it("does not read legacy personSync.actorPhotoFolder values", () => {
    const configuration = configurationSchema.parse({
      personSync: {
        actorPhotoFolder: "/legacy/actor-library",
        personOverviewSources: ["official"],
        personImageSources: ["local", "official"],
      },
    });

    expect(configuration.paths.actorPhotoFolder).toBe("actor_photo");
    expect(configuration.personSync).not.toHaveProperty("actorPhotoFolder");
  });

  it("requires Jellyfin userId to be a UUID when provided", () => {
    const result = configurationSchema.safeParse({
      jellyfin: {
        userId: "not-a-uuid",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["jellyfin", "userId"],
          message: "Jellyfin 用户 ID 必须为 UUID，留空则按服务端默认处理",
        }),
      ]),
    );
  });
});
