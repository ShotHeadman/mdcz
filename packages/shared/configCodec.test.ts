import { describe, expect, it } from "vitest";
import { configurationSchema, defaultConfiguration, NFO_FIELD_OPTIONS, type NfoField } from "./config";
import { parseConfigurationContent, serializeConfiguration } from "./configCodec";

describe("configuration codec", () => {
  it("defaults separated metadata storage off and round-trips an explicit path", () => {
    expect(parseConfigurationContent("[paths]\n", "toml").paths.metadataPath).toBe("");

    const configuration = {
      ...defaultConfiguration,
      paths: { ...defaultConfiguration.paths, metadataPath: "/local/metadata" },
    };

    expect(parseConfigurationContent(serializeConfiguration(configuration, "toml"), "toml").paths.metadataPath).toBe(
      "/local/metadata",
    );
  });

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
  it("defaults filename token lists to empty and round-trips configured literal values", () => {
    expect(defaultConfiguration.scrape).toMatchObject({
      filenameIgnoreTokens: [],
      filenameBlacklistTokens: [],
    });

    const configuration = {
      ...defaultConfiguration,
      scrape: {
        ...defaultConfiguration.scrape,
        filenameIgnoreTokens: ["[7SIS-001]+", "AD"],
        filenameBlacklistTokens: ["sample.", "广告"],
      },
    };

    expect(parseConfigurationContent(serializeConfiguration(configuration, "toml"), "toml").scrape).toMatchObject({
      filenameIgnoreTokens: ["[7SIS-001]+", "AD"],
      filenameBlacklistTokens: ["sample.", "广告"],
    });
    expect(parseConfigurationContent("[scrape]\n", "toml").scrape).toMatchObject({
      filenameIgnoreTokens: [],
      filenameBlacklistTokens: [],
    });
  });

  it("defaults, validates, and round-trips NFO fields through every configuration codec", () => {
    const expectedFields: NfoField[] = [
      "num",
      "plot",
      "release",
      "runtime",
      "fileinfo",
      "rating",
      "studio",
      "director",
      "publisher",
      "series",
      "genres",
      "tags",
      "poster",
      "thumb",
      "fanart",
      "sceneImages",
      "trailer",
      "sourceComment",
    ];
    expect(NFO_FIELD_OPTIONS).toEqual(expectedFields);
    expect(defaultConfiguration.download.nfoIgnoreFields).toEqual([]);

    const configuration = {
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        nfoIgnoreFields: ["num", "plot", "director"] as NfoField[],
      },
    };

    for (const format of ["toml", "json"] as const) {
      expect(
        parseConfigurationContent(serializeConfiguration(configuration, format), format).download.nfoIgnoreFields,
      ).toEqual(["num", "plot", "director"]);
      expect(
        parseConfigurationContent(
          serializeConfiguration(
            {
              ...configuration,
              download: { ...configuration.download, nfoIgnoreFields: [] },
            },
            format,
          ),
          format,
        ).download.nfoIgnoreFields,
      ).toEqual([]);
      expect(
        parseConfigurationContent(format === "toml" ? "[download]\n" : '{"download":{}}', format).download
          .nfoIgnoreFields,
      ).toEqual([]);
      expect(() =>
        parseConfigurationContent(
          format === "toml"
            ? '[download]\nnfoIgnoreFields = ["actors"]\n'
            : '{"download":{"nfoIgnoreFields":["actors"]}}',
          format,
        ),
      ).toThrow();
    }
  });
});
