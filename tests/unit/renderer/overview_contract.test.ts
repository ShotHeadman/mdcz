import { createOverviewInvalidationTracker } from "@renderer/hooks/useIpcSync";
import { describe, expect, it } from "vitest";

describe("overview UI contract", () => {
  it("refreshes overview data when a scrape button-status cycle returns to idle", () => {
    const shouldInvalidate = createOverviewInvalidationTracker();

    expect(shouldInvalidate(false)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(false)).toBe(true);
    expect(shouldInvalidate(false)).toBe(false);
  });
});
