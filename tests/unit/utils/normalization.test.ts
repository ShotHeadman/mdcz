import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { describe, expect, it } from "vitest";

describe("normalizeCode", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode("")).toBe("");
  });

  it("removes separators and uppercases", () => {
    expect(normalizeCode("abc-123")).toBe("ABC123");
    expect(normalizeCode("  abc_def  ")).toBe("ABCDEF");
    expect(normalizeCode("ABC 123")).toBe("ABC123");
  });

  it("handles multiple consecutive separators", () => {
    expect(normalizeCode("a--b__c  d")).toBe("ABCD");
  });
});

describe("normalizeText", () => {
  it("returns empty string for null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeText("  hello   world  ")).toBe("hello world");
    expect(normalizeText("a\t\nb")).toBe("a b");
  });
});
