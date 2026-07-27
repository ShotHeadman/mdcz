import { describe, expect, it } from "vitest";
import { shouldRunStartupUpdateCheck } from "./updateCheckPolicy";

describe("startup update check policy", () => {
  it("runs only for packaged releases with update checks enabled", () => {
    expect(shouldRunStartupUpdateCheck({ enabled: true, isPackaged: true })).toBe(true);
    expect(shouldRunStartupUpdateCheck({ enabled: false, isPackaged: true })).toBe(false);
    expect(shouldRunStartupUpdateCheck({ enabled: true, isPackaged: false })).toBe(false);
  });
});
