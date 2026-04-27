import { configurationSchema } from "@main/services/config/models";
import { describe, expect, it } from "vitest";

describe("Configuration compatibility policy", () => {
  it("builds a complete default config without a version field", () => {
    const configuration = configurationSchema.parse({});

    expect(configuration.network.timeout).toBe(10);
    expect(configuration.download.downloadThumb).toBe(true);
    expect(configuration.paths.configDirectory).toBe("config");
    expect(configuration).not.toHaveProperty("configVersion");
  });

  it("drops unknown legacy keys instead of converting them", () => {
    const configuration = configurationSchema.parse({
      configVersion: 1,
      download: {
        downloadCover: false,
        downloadNfo: false,
      },
      server: {
        url: "http://192.168.1.100:8096",
      },
      translate: {
        llmMaxTry: 9,
      },
    });

    expect(configuration.download.downloadThumb).toBe(true);
    expect(configuration.download.generateNfo).toBe(true);
    expect(configuration.translate.llmMaxRetries).toBe(3);
    expect(configuration).not.toHaveProperty("configVersion");
    expect(configuration).not.toHaveProperty("server");
    expect(configuration.download).not.toHaveProperty("downloadCover");
    expect(configuration.download).not.toHaveProperty("downloadNfo");
    expect(configuration.translate).not.toHaveProperty("llmMaxTry");
  });
});
