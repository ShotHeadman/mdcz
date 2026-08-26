import {
  buildAutoSaveFlatPayload,
  buildSettingsBrowseState,
  FIELD_REGISTRY,
  flattenConfig,
  mergeConfigWithFlatPayload,
  runLatestRevisionTask,
  unflattenConfig,
} from "@mdcz/views/settings";
import { describe, expect, it, vi } from "vitest";

function entry(key: string) {
  return FIELD_REGISTRY.find((candidate) => candidate.key === key);
}

describe("settings editor metadata and filtering", () => {
  it("keeps the settings search surface explicit and hides unrelated config keys", () => {
    expect(entry("translate.engine")?.anchor).toBe("translate");
    expect(entry("download.sceneImageConcurrency")?.visibility).toBe("advanced");
    expect(entry("download.tagBadgeTypes")).toMatchObject({ anchor: "download", visibility: "public" });
    expect(entry("download.nfoIgnoreFields")).toMatchObject({ anchor: "download", visibility: "public" });
    expect(entry("paths.defaultScanExcludeDirs")).toMatchObject({ anchor: "paths", visibility: "public" });
    expect(entry("scrape.r18MetadataLanguage")).toMatchObject({ anchor: "scrape", visibility: "hidden" });
    expect(entry("scrape.filenameIgnoreTokens")).toMatchObject({ anchor: "scrape", visibility: "public" });
    expect(entry("scrape.filenameBlacklistTokens")).toMatchObject({ anchor: "scrape", visibility: "public" });
    expect(entry("jellyfin.url")).toMatchObject({ surface: "tools" });

    const keys = new Set(FIELD_REGISTRY.map((candidate) => candidate.key));
    expect(keys.has("behavior.updateCheck")).toBe(false);
    expect(FIELD_REGISTRY.findIndex((candidate) => candidate.key === "paths.defaultScanExcludeDirs")).toBe(
      FIELD_REGISTRY.findIndex((candidate) => candidate.key === "paths.failedOutputFolder") + 1,
    );
  });

  it("round-trips registered settings, including scrape order and aggregation paths", () => {
    const flat = flattenConfig({
      download: {
        tagBadgeTypes: ["subtitle", "leak"],
        nfoIgnoreFields: ["director"],
      },
      scrape: {
        sites: ["javdb"],
        filenameIgnoreTokens: ["[7SIS-001]+"],
        filenameBlacklistTokens: ["sample."],
      },
      paths: {
        defaultScanExcludeDirs: ["failed_22", "/archive/output"],
      },
      aggregation: {
        fieldPriorities: {
          durationSeconds: ["dmm_tv", "avbase"],
        },
      },
    });

    expect(flat).toMatchObject({
      "download.tagBadgeTypes": ["subtitle", "leak"],
      "download.nfoIgnoreFields": ["director"],
      "scrape.sites": ["javdb"],
      "scrape.filenameIgnoreTokens": ["[7SIS-001]+"],
      "scrape.filenameBlacklistTokens": ["sample."],
      "paths.defaultScanExcludeDirs": ["failed_22", "/archive/output"],
      "aggregation.fieldPriorities.durationSeconds": ["dmm_tv", "avbase"],
    });
    expect(unflattenConfig(flat)).toMatchObject({
      download: { nfoIgnoreFields: ["director"], tagBadgeTypes: ["subtitle", "leak"] },
      scrape: {
        sites: ["javdb"],
        filenameIgnoreTokens: ["[7SIS-001]+"],
        filenameBlacklistTokens: ["sample."],
      },
      paths: { defaultScanExcludeDirs: ["failed_22", "/archive/output"] },
      aggregation: { fieldPriorities: { durationSeconds: ["dmm_tv", "avbase"] } },
    });
  });

  it("applies PRD visibility rules for normal, advanced, modified, group, and deep-link browsing", () => {
    const normal = buildSettingsBrowseState({ query: "", showAdvanced: false, modifiedKeys: new Set<string>() });
    expect(normal.visibleKeySet.has("paths.mediaPath")).toBe(true);
    expect(normal.visibleKeySet.has("download.sceneImageConcurrency")).toBe(false);
    expect(normal.visibleKeySet.has("jellyfin.url")).toBe(false);

    const advanced = buildSettingsBrowseState({ query: "", showAdvanced: true, modifiedKeys: new Set<string>() });
    expect(advanced.visibleKeySet.has("download.sceneImageConcurrency")).toBe(true);
    expect(advanced.visibleAdvancedAnchorSet.has("download")).toBe(true);

    const modified = buildSettingsBrowseState({
      query: "@modified",
      showAdvanced: false,
      modifiedKeys: new Set(["download.sceneImageConcurrency", "paths.mediaPath"]),
    });
    expect(modified.visibleEntries.map((candidate) => candidate.key)).toEqual(["paths.mediaPath"]);

    const grouped = buildSettingsBrowseState({
      query: "@group:系统 日志面板",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    expect(grouped.hasActiveFilters).toBe(true);
    expect(grouped.visibleEntries.map((candidate) => candidate.key)).toEqual(["ui.showLogsPanel"]);
  });

  it("reveals normal conditional rows in search while preserving the advanced visibility gate", () => {
    const hiddenDownloadChildSearch = buildSettingsBrowseState({
      query: "保留已有横版缩略图",
      showAdvanced: false,
      modifiedKeys: new Set(["download.keepThumb"]),
    });
    expect(hiddenDownloadChildSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["download.keepThumb"]);

    const hiddenLlmField = buildSettingsBrowseState({
      query: "LLM 模型名称",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    expect(hiddenLlmField.visibleEntries.map((candidate) => candidate.key)).toEqual(["translate.llmModelName"]);

    const hiddenAdvancedField = buildSettingsBrowseState({
      query: "剧照下载并发",
      showAdvanced: false,
      modifiedKeys: new Set(["download.sceneImageConcurrency"]),
    });
    expect(hiddenAdvancedField.visibleEntries).toEqual([]);

    const visibleAdvancedField = buildSettingsBrowseState({
      query: "剧照下载并发",
      showAdvanced: true,
      modifiedKeys: new Set(["download.sceneImageConcurrency"]),
    });
    expect(visibleAdvancedField.visibleEntries.map((candidate) => candidate.key)).toEqual([
      "download.sceneImageConcurrency",
    ]);
  });

  it("matches registered field and grouped-site search aliases", () => {
    const badgeTypeAliasSearch = buildSettingsBrowseState({
      query: "subtitle",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgeResolutionAliasSearch = buildSettingsBrowseState({
      query: "4k",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgePositionAliasSearch = buildSettingsBrowseState({
      query: "top right",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const badgeImageAliasSearch = buildSettingsBrowseState({
      query: "watermark",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });
    const siteAliasSearch = buildSettingsBrowseState({
      query: "fanza",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(badgeTypeAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain("download.tagBadgeTypes");
    expect(badgeResolutionAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgeTypes",
    );
    expect(badgePositionAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgePosition",
    );
    expect(badgeImageAliasSearch.visibleEntries.map((candidate) => candidate.key)).toContain(
      "download.tagBadgeImageOverrides",
    );
    expect(siteAliasSearch.visibleEntries.map((candidate) => candidate.key)).toEqual(["scrape.sites"]);
  });
});

describe("settings editor save and content helpers", () => {
  it("builds autosave payloads for related server-error fields and merges cache updates", () => {
    const payload = buildAutoSaveFlatPayload(
      "translate.llmApiKey",
      "secret",
      {
        translate: {
          engine: { type: "server", message: "缺少 API Key" },
          llmApiKey: { type: "server", message: "缺少 API Key" },
        },
      },
      (fieldPath) => (fieldPath === "translate.engine" ? "openai" : undefined),
    );

    expect(payload).toEqual({
      "translate.engine": "openai",
      "translate.llmApiKey": "secret",
    });
    expect(
      mergeConfigWithFlatPayload(
        { translate: { engine: "google", llmApiKey: "" } },
        { "translate.engine": "openai", "translate.llmApiKey": "secret" },
      ),
    ).toEqual({
      translate: { engine: "openai", llmApiKey: "secret" },
    });
  });

  it("finalizes stale autosave revisions without running superseded work", async () => {
    const revisions = new Map([["paths.mediaPath", 2]]);
    const run = vi.fn(async () => {});
    const finalize = vi.fn();

    await runLatestRevisionTask({
      revisions,
      path: "paths.mediaPath",
      revision: 1,
      run,
      finalize,
    });

    expect(run).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);

    await runLatestRevisionTask({
      revisions,
      path: "paths.mediaPath",
      revision: 2,
      run,
      finalize,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });
});
