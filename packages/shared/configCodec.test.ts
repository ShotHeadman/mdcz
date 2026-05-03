import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./config";
import { parseConfigurationContent, serializeConfiguration } from "./configCodec";

const partialToml = `
[network]
timeout = 25
retryCount = 4
proxyType = "http"

[paths]
configDirectory = "server-config"

[scrape]
sites = ["dmm", "javdb"]
`;

describe("configuration codec", () => {
  it("serializes and parses TOML configuration", () => {
    const content = serializeConfiguration(defaultConfiguration, "toml");
    const parsed = parseConfigurationContent(content, "toml");

    expect(parsed).toEqual(defaultConfiguration);
    expect(content).toContain("[network]");
    expect(content).toContain('proxyType = "none"');
  });

  it("parses partial TOML through the shared configuration schema", () => {
    const parsed = parseConfigurationContent(partialToml, "toml");

    expect(parsed.network.timeout).toBe(25);
    expect(parsed.network.retryCount).toBe(4);
    expect(parsed.paths.configDirectory).toBe("server-config");
    expect(parsed.scrape.sites).toEqual(["dmm", "javdb"]);
    expect(parsed.download.downloadThumb).toBe(true);
  });

  it("keeps JSON compatibility", () => {
    const content = serializeConfiguration(defaultConfiguration, "json");
    const parsed = parseConfigurationContent(content, "json");

    expect(parsed).toEqual(defaultConfiguration);
    expect(content.trim().startsWith("{")).toBe(true);
  });
});
