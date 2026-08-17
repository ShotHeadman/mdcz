import type { LibraryAvailabilityResponse, LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { describe, expect, it } from "vitest";
import { chunkLibraryEntryIds, mergeLibraryAvailability } from "./availability";

const createEntry = (id: string): LibraryEntryDto => ({
  actors: [],
  assets: [],
  available: null,
  crawlerData: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  directory: "movies",
  fileName: `${id}.mp4`,
  fileRefs: [
    {
      available: null,
      directory: "movies",
      fileName: `${id}.mp4`,
      id: `file-${id}`,
      lastKnownPath: null,
      modifiedAt: null,
      relativePath: `movies/${id}.mp4`,
      rootDisplayName: "Media",
      rootId: "root-1",
      size: 10,
    },
  ],
  hiddenFromRecentAt: null,
  id,
  lastKnownPath: null,
  lastRefreshedAt: null,
  mediaIdentity: id,
  modifiedAt: null,
  number: id,
  relativePath: `movies/${id}.mp4`,
  rootDisplayName: "Media",
  rootId: "root-1",
  scrapeOutputId: null,
  size: 10,
  taskId: null,
  thumbnailPath: null,
  title: id,
});

describe("library availability helpers", () => {
  it("merges entry and file availability without changing entries missing from the response", () => {
    const first = createEntry("ABC-001");
    const second = createEntry("ABC-002");
    const responses: LibraryAvailabilityResponse[] = [
      {
        entries: [
          {
            available: true,
            fileRefs: [{ available: false, id: "file-ABC-001" }],
            id: "ABC-001",
          },
        ],
      },
    ];

    const merged = mergeLibraryAvailability([first, second], responses);

    expect(merged[0]).toMatchObject({ available: true, fileRefs: [{ available: false }] });
    expect(merged[1]).toBe(second);
    expect(first.available).toBeNull();
  });

  it("splits ids into bounded requests and rejects invalid sizes", () => {
    expect(chunkLibraryEntryIds(["1", "2", "3", "4", "5"], 2)).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    expect(chunkLibraryEntryIds([])).toEqual([]);
    expect(() => chunkLibraryEntryIds(["1"], 0)).toThrow(RangeError);
  });
});
