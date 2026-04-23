import { buildSettingsBrowseState } from "@renderer/components/settings/settingsBrowseState";
import { describe, expect, it } from "vitest";

describe("settingsBrowseState", () => {
  it("keeps public deep links inside their owning public section", () => {
    const state = buildSettingsBrowseState({
      query: "",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
      deepLinkSettingKey: "paths.mediaPath",
    });

    expect(state.targetFieldKey).toBe("paths.mediaPath");
    expect(state.targetSectionId).toBe("paths");
    expect(state.isAdvancedVisible).toBe(false);
    expect(state.visibleKeySet.has("paths.mediaPath")).toBe(true);
  });

  it("ignores unsupported advanced deep links", () => {
    const state = buildSettingsBrowseState({
      query: "",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
      deepLinkSettingKey: "aggregation.maxParallelCrawlers",
    });

    expect(state.targetFieldKey).toBeNull();
    expect(state.targetSectionId).toBeNull();
    expect(state.isAdvancedVisible).toBe(false);
    expect(state.visibleKeySet.has("aggregation.maxParallelCrawlers")).toBe(false);
  });

  it("derives filtered browse results from the query without extra state", () => {
    const state = buildSettingsBrowseState({
      query: "@group:系统 日志面板",
      showAdvanced: false,
      modifiedKeys: new Set<string>(),
    });

    expect(state.hasActiveFilters).toBe(true);
    expect(state.visibleEntries.map((entry) => entry.key)).toEqual(["ui.showLogsPanel"]);
  });
});
