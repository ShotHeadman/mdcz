import { createDashboardInvalidationTracker } from "@renderer/hooks/useIpcSync";
import { describe, expect, it } from "vitest";

describe("useIpcSync dashboard invalidation tracking", () => {
  it("invalidates only on buttonStatus-derived active to idle transitions", () => {
    const shouldInvalidate = createDashboardInvalidationTracker();

    expect(shouldInvalidate(false)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(false)).toBe(true);
    expect(shouldInvalidate(false)).toBe(false);
  });
});
