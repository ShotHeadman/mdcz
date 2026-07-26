import { describe, expect, it } from "vitest";
import { configurationSchema, defaultConfiguration } from "./config";
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

  it("round-trips actor alias maps through TOML and validates alias groups", () => {
    const parsed = parseConfigurationContent(
      '[personSync.actorAliases]\n"河北彩花" = ["河北彩伽", "河北彩花（河北彩伽）"]\n',
      "toml",
    );

    expect(parsed.personSync.actorAliases).toEqual({ 河北彩花: ["河北彩伽", "河北彩花（河北彩伽）"] });
    expect(parseConfigurationContent(serializeConfiguration(parsed, "toml"), "toml")).toEqual(parsed);
    expect(
      parseConfigurationContent('[personSync]\npersonImageSources = ["local"]\n', "toml").personSync.actorAliases,
    ).toEqual({});

    expect(
      configurationSchema.parse({
        personSync: {
          actorAliases: { " 河北彩花 ": ["河北彩伽", " 河北彩伽 ", "河北彩花"] },
        },
      }).personSync.actorAliases,
    ).toEqual({ 河北彩花: ["河北彩伽"] });

    const collision = configurationSchema.safeParse({
      personSync: {
        actorAliases: {
          河北彩花: ["河北彩伽"],
          河北彩伽: ["别名"],
        },
      },
    });

    expect(collision.success).toBe(false);
    if (!collision.success) {
      expect(collision.error.issues[0]?.path).toEqual(["personSync", "actorAliases", "河北彩伽"]);
    }

    expect(
      configurationSchema.safeParse({
        personSync: { actorAliases: { 河北彩花: [] } },
      }).success,
    ).toBe(false);
  });
});
