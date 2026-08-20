import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("returns a zero label for values that cannot be sized", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("formats bytes without a fraction and larger units with one by default", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("caps at the largest known unit", () => {
    expect(formatBytes(1024 ** 6)).toBe("1048576.0 TB");
  });

  it("honours an explicit fraction width", () => {
    expect(formatBytes(1024 ** 4 + 1024 ** 3 * 200, { fractionDigits: 2 })).toBe("1.20 TB");
    expect(formatBytes(1536, { fractionDigits: 2 })).toBe("1.50 KB");
    expect(formatBytes(1536, { fractionDigits: 0 })).toBe("2 KB");
  });

  it("trims trailing fraction zeros on request, including the decimal point", () => {
    expect(formatBytes(1024, { trimTrailingZeros: true })).toBe("1 KB");
    expect(formatBytes(10 * 1024, { trimTrailingZeros: true })).toBe("10 KB");
    expect(formatBytes(1536, { trimTrailingZeros: true })).toBe("1.5 KB");
    expect(formatBytes(1024, { fractionDigits: 2, trimTrailingZeros: true })).toBe("1 KB");
    expect(formatBytes(1536, { fractionDigits: 2, trimTrailingZeros: true })).toBe("1.5 KB");
    expect(formatBytes(500, { trimTrailingZeros: true })).toBe("500 B");
  });
});
