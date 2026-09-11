import { describe, expect, it } from "vitest";
import { hasWorkbenchOutput } from "./overview";

describe("web overview output state", () => {
  it("treats recent acquisitions as completed output evidence", () => {
    expect(hasWorkbenchOutput({ mediaRootCount: 0, output: null, recentCount: 1 })).toBe(true);
  });

  it.each([0, 1])("uses media roots to determine readiness for an empty overview (%i roots)", (mediaRootCount) => {
    expect(
      hasWorkbenchOutput({
        mediaRootCount,
        output: { fileCount: 0, totalBytes: 0, rootPath: null },
        recentCount: 0,
      }),
    ).toBe(mediaRootCount > 0);
  });
});
