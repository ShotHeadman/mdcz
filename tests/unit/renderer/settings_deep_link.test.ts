import { resolveSettingsDeepLink } from "@renderer/components/settings/settingsDeepLink";
import { describe, expect, it } from "vitest";

describe("settingsDeepLink", () => {
  it("maps public settings to their owning section", () => {
    expect(resolveSettingsDeepLink(" paths.mediaPath ")).toEqual({
      fieldKey: "paths.mediaPath",
      sectionId: "paths",
    });
  });

  it("treats advanced settings as unsupported deep-link targets", () => {
    expect(resolveSettingsDeepLink("aggregation.maxParallelCrawlers")).toEqual({
      fieldKey: null,
      sectionId: null,
    });
  });

  it("treats unknown deep links as no-op targets", () => {
    expect(resolveSettingsDeepLink(" unknown.setting ")).toEqual({
      fieldKey: null,
      sectionId: null,
    });
  });
});
