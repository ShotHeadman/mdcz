import { describe, expect, it, vi } from "vitest";

import { DesktopLibraryService } from "./DesktopLibraryService";

describe("DesktopLibraryService deletion", () => {
  it("removes only the movie record", async () => {
    const deleteEntry = vi.fn();
    const service = new DesktopLibraryService({
      getState: async () => ({
        repositories: {
          library: {
            deleteEntry,
            getEntryById: async () => ({
              id: "item-1",
              rootId: "media",
              rootRelativePath: "ABC-123/ABC-123-CD1.mp4",
              files: [
                { id: "file-1", rootId: "media", rootRelativePath: "ABC-123/ABC-123-CD1.mp4" },
                { id: "file-2", rootId: "media", rootRelativePath: "ABC-123/ABC-123-CD2.mp4" },
              ],
              assets: [{ id: "asset-1", kind: "poster", rootId: "media", relativePath: "ABC-123/poster.jpg" }],
            }),
          },
          libraryRepairIssues: {},
          mediaRoots: {
            list: async () => [{ id: "media", hostPath: "C:/media" }],
          },
          publicationJournal: {},
        },
      }),
    } as never);

    await service.deleteEntry("item-1");
    expect(deleteEntry).toHaveBeenCalledWith("item-1");
  });
});
