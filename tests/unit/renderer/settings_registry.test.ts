import { FIELD_REGISTRY, flattenConfig, unflattenConfig } from "@renderer/components/settings/settingsRegistry";
import { describe, expect, it } from "vitest";

describe("settingsRegistry", () => {
  it("exposes the cross-field validation source and target under the same anchor", () => {
    // prd.md §R2 canonical case: toggling translate.engine to "openai" with an
    // empty translate.llmApiKey must surface a banner on the owning section.
    // For the banner to collect the error, both fields must share the anchor.
    const engine = FIELD_REGISTRY.find((entry) => entry.key === "translate.engine");
    const llmApiKey = FIELD_REGISTRY.find((entry) => entry.key === "translate.llmApiKey");

    expect(engine?.anchor).toBe("dataSources");
    expect(llmApiKey?.anchor).toBe("dataSources");
  });

  it("round-trips nested config through flatten + unflatten without losing registered fields", () => {
    const source = {
      translate: {
        engine: "openai",
        llmApiKey: "secret",
      },
      naming: {
        folderTemplate: "{actor}/{number}",
        fileTemplate: "{number}",
      },
      scrape: {
        sites: ["javdb"],
        siteConfigs: {
          javdb: { customUrl: "https://example.org" },
        },
      },
      aggregation: {
        fieldPriorities: {
          durationSeconds: ["dmm_tv", "avbase"],
        },
      },
    };

    const flat = flattenConfig(source);
    expect(flat["translate.engine"]).toBe("openai");
    expect(flat["translate.llmApiKey"]).toBe("secret");
    expect(flat["naming.folderTemplate"]).toBe("{actor}/{number}");
    expect(flat["scrape.siteConfigs.javdb.customUrl"]).toBe("https://example.org");
    expect(flat["aggregation.fieldPriorities.durationSeconds"]).toEqual(["dmm_tv", "avbase"]);

    const roundTripped = unflattenConfig(flat);
    expect(roundTripped).toMatchObject({
      translate: { engine: "openai", llmApiKey: "secret" },
      naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" },
      scrape: { siteConfigs: { javdb: { customUrl: "https://example.org" } } },
      aggregation: {
        fieldPriorities: {
          durationSeconds: ["dmm_tv", "avbase"],
        },
      },
    });
  });

  it("unflatten builds nested objects for partial auto-save payloads", () => {
    // useAutoSaveField persists partial dotted-path payloads before sending them
    // to ipc.config.save. Make sure dynamic segments (site customUrls) still
    // nest correctly.
    const payload = unflattenConfig({ "scrape.siteConfigs.javdb.customUrl": "https://mirror.example" });
    expect(payload).toMatchObject({
      scrape: { siteConfigs: { javdb: { customUrl: "https://mirror.example" } } },
    });
  });

  it("marks selected expert-level fields as advanced while keeping public settings searchable", () => {
    expect(FIELD_REGISTRY.find((entry) => entry.key === "download.sceneImageConcurrency")?.visibility).toBe("advanced");
    expect(FIELD_REGISTRY.find((entry) => entry.key === "aggregation.maxParallelCrawlers")?.visibility).toBe(
      "advanced",
    );
    expect(
      FIELD_REGISTRY.find((entry) => entry.key === "aggregation.fieldPriorities.durationSeconds")?.visibility,
    ).toBe("advanced");
    expect(FIELD_REGISTRY.find((entry) => entry.key === "naming.partStyle")?.visibility).toBe("public");
    expect(FIELD_REGISTRY.find((entry) => entry.key === "translate.llmPrompt")?.visibility).toBe("public");
    expect(FIELD_REGISTRY.find((entry) => entry.key === "paths.mediaPath")?.visibility).toBe("public");
  });

  it("exposes public advanced download and aggregation keys while hiding other-surface or internal keys", () => {
    const keys = new Set(FIELD_REGISTRY.map((entry) => entry.key));

    expect(keys.has("download.sceneImageConcurrency")).toBe(true);
    expect(keys.has("aggregation.maxParallelCrawlers")).toBe(true);
    expect(keys.has("aggregation.behavior.maxSceneImages")).toBe(true);
    expect(keys.has("aggregation.fieldPriorities.durationSeconds")).toBe(true);
    expect(keys.has("behavior.updateCheck")).toBe(false);
    expect(keys.has("ui.theme")).toBe(false);
    expect(keys.has("ui.language")).toBe(false);
  });
});
