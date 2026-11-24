import { describe, expect, it } from "vitest";
import { decodeLibraryPageCursor, encodeLibraryPageCursor, type LibraryPageCursor } from "./libraryPagination";

describe("library page cursors", () => {
  it.each<LibraryPageCursor>([
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      createdAt: Date.parse("2026-08-17T10:20:30.456Z"),
      id: "root:影片%ABC-001",
    },
    {
      sortBy: "number",
      sortOrder: "asc",
      value: "SSIS-001",
      id: "entry-1",
    },
    {
      sortBy: "title",
      sortOrder: "desc",
      value: "中文标题:测试%100",
      id: "entry-2",
    },
  ])("round-trips $sortBy ($sortOrder) cursor with arbitrary UTF-8 content", (cursor) => {
    expect(decodeLibraryPageCursor(encodeLibraryPageCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "invalid",
    "{}",
    '{"sortBy":"title","sortOrder":"asc","value":"A","id":""}',
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => decodeLibraryPageCursor(cursor)).toThrow("Invalid library page cursor");
  });

  it("treats an absent cursor as the first page", () => {
    expect(decodeLibraryPageCursor(undefined)).toBeUndefined();
    expect(decodeLibraryPageCursor("  ")).toBeUndefined();
  });
});
