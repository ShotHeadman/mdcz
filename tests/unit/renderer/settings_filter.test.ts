import {
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

  it("@advanced reveals advanced settings without changing the grouped ordering", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@advanced"));

    expect(visibleEntries.find((entry) => entry.key === "download.sceneImageConcurrency")).toBeTruthy();
    expect(visibleEntries.find((entry) => entry.key === "aggregation.maxParallelCrawlers")).toBeTruthy();
    expect(visibleEntries.find((entry) => entry.key === "aggregation.fieldPriorities.durationSeconds")).toBeTruthy();
  });

  it("@id targets advanced settings directly even when advanced browse mode is off", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@id:download.sceneImageConcurrency"));

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["download.sceneImageConcurrency"]);
  });

  it("@id targets aggregation priority settings directly even when advanced browse mode is off", () => {
    const visibleEntries = getVisibleEntries(
      FIELD_REGISTRY,
      buildState("@id:aggregation.fieldPriorities.durationSeconds"),
    );

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["aggregation.fieldPriorities.durationSeconds"]);
  });

  it("@modified can surface advanced settings that diverge from defaults", () => {
    const visibleEntries = getVisibleEntries(
      FIELD_REGISTRY,
      buildState("@modified", {
        modifiedKeys: new Set(["download.sceneImageConcurrency", "paths.mediaPath"]),
      }),
    );

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["paths.mediaPath", "download.sceneImageConcurrency"]);
  });

  it("composes text and group filters with AND semantics", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@group:系统 日志面板"));

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["ui.showLogsPanel"]);
  });
});
