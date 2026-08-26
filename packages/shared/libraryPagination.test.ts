import { describe, expect, it } from "vitest";
import { decodeLibraryPageCursor, encodeLibraryPageCursor } from "./libraryPagination";

describe("library page cursors", () => {
  it("round-trips timestamps and ids containing encoded delimiters", () => {
    const cursor = {
      createdAt: new Date("2026-08-17T10:20:30.456Z"),
      id: "root:影片%ABC-001",
    };

    expect(decodeLibraryPageCursor(encodeLibraryPageCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "invalid",
    ":entry",
    "-1:entry",
    "1:",
    "NaN:entry",
    "1:%E0%A4%A",
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => decodeLibraryPageCursor(cursor)).toThrow("Invalid library page cursor");
  });

  it("treats an absent cursor as the first page", () => {
    expect(decodeLibraryPageCursor(undefined)).toBeUndefined();
    expect(decodeLibraryPageCursor("  ")).toBeUndefined();
  });
});
