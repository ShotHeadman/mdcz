import {
  getSettingsSuggestions,
  getVisibleEntries,
  parseSettingsQuery,
  type SettingsFilterState,
} from "@renderer/components/settings/settingsFilter";
import { FIELD_REGISTRY } from "@renderer/components/settings/settingsRegistry";
import { describe, expect, it } from "vitest";

function buildState(query: string, options?: Partial<Omit<SettingsFilterState, "parsedQuery">>): SettingsFilterState {
  return {
    parsedQuery: parseSettingsQuery(query),
    showAdvanced: false,
    modifiedKeys: new Set<string>(),
    ...options,
  };
}

describe("settingsFilter", () => {
  it("keeps advanced settings hidden during ordinary browse mode", () => {
    const visibleKeys = new Set(getVisibleEntries(FIELD_REGISTRY, buildState("")).map((entry) => entry.key));

    expect(visibleKeys.has("download.sceneImageConcurrency")).toBe(false);
    expect(visibleKeys.has("aggregation.maxParallelCrawlers")).toBe(false);
    expect(visibleKeys.has("naming.partStyle")).toBe(true);
    expect(visibleKeys.has("paths.mediaPath")).toBe(true);
  });

  it("showAdvanced reveals advanced settings without changing the grouped ordering", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("", { showAdvanced: true }));

    expect(visibleEntries.find((entry) => entry.key === "download.sceneImageConcurrency")).toBeTruthy();
    expect(visibleEntries.find((entry) => entry.key === "aggregation.maxParallelCrawlers")).toBeTruthy();
    expect(visibleEntries.find((entry) => entry.key === "aggregation.fieldPriorities.durationSeconds")).toBeTruthy();
  });

  it("@modified keeps advanced settings hidden while advanced mode is off", () => {
    const visibleEntries = getVisibleEntries(
      FIELD_REGISTRY,
      buildState("@modified", {
        modifiedKeys: new Set(["download.sceneImageConcurrency", "paths.mediaPath"]),
      }),
    );

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["paths.mediaPath"]);
  });

  it("free-text search can match advanced settings after advanced mode is enabled", () => {
    const hiddenEntries = getVisibleEntries(FIELD_REGISTRY, buildState("聚合并行站点"));
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("聚合并行站点", { showAdvanced: true }));

    expect(hiddenEntries).toEqual([]);
    expect(visibleEntries.map((entry) => entry.key)).toEqual(["aggregation.maxParallelCrawlers"]);
  });

  it("@modified can include advanced settings after advanced mode is enabled", () => {
    const visibleEntries = getVisibleEntries(
      FIELD_REGISTRY,
      buildState("@modified", {
        showAdvanced: true,
        modifiedKeys: new Set(["download.sceneImageConcurrency", "paths.mediaPath"]),
      }),
    );

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["paths.mediaPath", "download.sceneImageConcurrency"]);
  });

  it("composes text and group filters with AND semantics", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@group:系统 日志面板"));

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["ui.showLogsPanel"]);
  });

  it("offers only the supported search tokens in visible suggestions", () => {
    const labels = getSettingsSuggestions("@").map((suggestion) => suggestion.label);

    expect(labels).toContain("@modified");
    expect(labels).toContain("@group:");
  });

  it("ignores unsupported token prefixes in the search UI", () => {
    expect(getSettingsSuggestions("@foo")).toEqual([]);
  });
});
