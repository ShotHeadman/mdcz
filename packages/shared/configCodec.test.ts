import { describe, expect, it } from "vitest";
import {
  configurationSchema,
  defaultConfiguration,
  NFO_FIELD_OPTIONS,
  type NfoField,
  resolveBriefLlmSettings,
} from "./config";
import { parseConfigurationContent, serializeConfiguration } from "./configCodec";

describe("configuration codec", () => {
  it("round-trips actor alias groups through TOML and validates them", () => {
    const parsed = parseConfigurationContent(
      '[[personSync.actorAliases]]\nname = "河北彩花"\naliases = ["河北彩伽", "河北彩花（河北彩伽）"]\n',
      "toml",
    );

    expect(parsed.personSync.actorAliases).toEqual([
      { name: "河北彩花", aliases: ["河北彩伽", "河北彩花（河北彩伽）"] },
    ]);
    expect(parseConfigurationContent(serializeConfiguration(parsed, "toml"), "toml")).toEqual(parsed);
    expect(
      parseConfigurationContent('[personSync]\npersonImageSources = ["local"]\n', "toml").personSync.actorAliases,
    ).toEqual([]);
    expect(parseConfigurationContent("[personSync.actorAliases]\n", "toml").personSync.actorAliases).toEqual([]);

    expect(
      configurationSchema.parse({
        personSync: { actorAliases: [{ name: " 河北彩花 ", aliases: ["河北彩伽", " 河北彩伽 ", "河北彩花"] }] },
      }).personSync.actorAliases,
    ).toEqual([{ name: "河北彩花", aliases: ["河北彩伽"] }]);

    const collision = configurationSchema.safeParse({
      personSync: {
        actorAliases: [
          { name: "河北彩花", aliases: ["河北彩伽"] },
          { name: "河北彩伽", aliases: ["别名"] },
        ],
      },
    });

    expect(collision.success).toBe(false);
    if (!collision.success) {
      expect(collision.error.issues[0]?.path).toEqual(["personSync", "actorAliases", 1, "name"]);
    }

    expect(
      configurationSchema.safeParse({ personSync: { actorAliases: [{ name: "河北彩花", aliases: [] }] } }).success,
    ).toBe(false);
    // The earlier canonical-name map is not read any more; such a file fails validation instead.
    expect(configurationSchema.safeParse({ personSync: { actorAliases: { 河北彩花: ["河北彩伽"] } } }).success).toBe(
      false,
    );
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
      "outline",
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

  it("defaults, resolves, and round-trips dedicated Brief model settings", () => {
    expect(defaultConfiguration.llm.briefModel).toBeNull();
    expect(resolveBriefLlmSettings(defaultConfiguration.llm).modelName).toBe(defaultConfiguration.llm.modelName);

    const dedicated = {
      ...defaultConfiguration,
      llm: {
        ...defaultConfiguration.llm,
        modelName: "gpt-4o-mini",
        briefModel: {
          ...defaultConfiguration.llm,
          modelName: "deepseek-reasoner",
          serviceType: "deepseek" as const,
          apiKey: "sk-brief",
          baseUrl: "https://api.deepseek.com/v1",
          reasoning: "enabled" as const,
          outputFormat: "json_object" as const,
          temperature: null,
        },
      },
    };

    for (const format of ["toml", "json"] as const) {
      const roundTripped = parseConfigurationContent(serializeConfiguration(dedicated, format), format);
      expect(roundTripped.llm.briefModel).toMatchObject({
        modelName: "deepseek-reasoner",
        serviceType: "deepseek",
        apiKey: "sk-brief",
        reasoning: "enabled",
        outputFormat: "json_object",
        temperature: null,
      });
      expect(resolveBriefLlmSettings(roundTripped.llm).modelName).toBe("deepseek-reasoner");

      const cleared = parseConfigurationContent(
        serializeConfiguration({ ...dedicated, llm: { ...dedicated.llm, briefModel: null } }, format),
        format,
      );
      expect(cleared.llm.briefModel).toBeNull();
      expect(resolveBriefLlmSettings(cleared.llm).modelName).toBe("gpt-4o-mini");
    }
  });
});
