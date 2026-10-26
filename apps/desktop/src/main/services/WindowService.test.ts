import { shell } from "electron";
import { describe, expect, it, vi } from "vitest";
import { openExternalInstead } from "./WindowService";

describe("WindowService isolation", () => {
  it("opens only http(s) links in the system browser and never a second window", () => {
    const openExternal = vi.spyOn(shell, "openExternal");
    for (const url of ["https://github.com/ShotHeadman/mdcz", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(openExternalInstead({ url })).toEqual({ action: "deny" });
    }
    expect(openExternal.mock.calls).toEqual([["https://github.com/ShotHeadman/mdcz"]]);
  });
});
