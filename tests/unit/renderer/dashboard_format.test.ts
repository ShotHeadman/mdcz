import { formatBytes } from "@renderer/components/dashboard/format";
import { describe, expect, it } from "vitest";

describe("dashboard format helpers", () => {
  it("formats byte counts for dashboard numeric UI", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
