import { describe, expect, it } from "vitest";

import { getSkeletonNavItems } from "./skeletonNav";

describe("getSkeletonNavItems", () => {
  it("lists the planned WebUI areas without enabling later slices", () => {
    expect(getSkeletonNavItems()).toEqual([
      { label: "Overview", status: "placeholder" },
      { label: "Media roots", status: "placeholder" },
      { label: "File browser", status: "placeholder" },
      { label: "Tasks", status: "placeholder" },
      { label: "Settings", status: "placeholder" },
    ]);
  });
});
