import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./config";
import { parseConfigurationContent, serializeConfiguration } from "./configCodec";

describe("configuration codec", () => {
  it("round-trips title repair array-of-tables through TOML", () => {
    const configuration = {
      ...defaultConfiguration,
      titleRepair: {
        enabled: true,
        rules: [
          { source: "催●", replacement: "催眠" },
          { source: "●●", replacement: "秘密" },
        ],
      },
    };

    const content = serializeConfiguration(configuration, "toml");

    expect(content).toContain("[[titleRepair.rules]]");
    expect(parseConfigurationContent(content, "toml")).toEqual(configuration);
  });

  it("parses TOML comments and special characters before schema validation", () => {
    const parsed = parseConfigurationContent(
      '[titleRepair]\nenabled = true # user setting\n\n[[titleRepair.rules]]\nsource = "催●"\nreplacement = "催眠 #1"\n',
      "toml",
    );

    expect(parsed.titleRepair).toEqual({
      enabled: true,
      rules: [{ source: "催●", replacement: "催眠 #1" }],
    });
  });

  it("rejects duplicate and ineffective title repair rules", () => {
    expect(() =>
      parseConfigurationContent(
        '[titleRepair]\nenabled = true\n\n[[titleRepair.rules]]\nsource = "催●"\nreplacement = "催眠"\n\n[[titleRepair.rules]]\nsource = "催●"\nreplacement = "催●"\n',
        "toml",
      ),
    ).toThrow();
  });
});
