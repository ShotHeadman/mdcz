import { libraryAvailability } from "@mdcz/shared/libraryAvailability";
import type { LibraryAvailabilityResponse, LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { describe, expect, it } from "vitest";
import { chunkLibraryEntryIds, mergeLibraryAvailability } from "./availability";

const createEntry = (id: string): LibraryEntryDto => ({
  actors: [],
  assets: [],
  available: "unchecked",
  crawlerData: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  displayFileId: `file-${id}`,
  fileRefs: [
    {
      available: null,
      availabilityError: null,
      directory: "movies",
      fileName: `${id}.mp4`,
      id: `file-${id}`,
      lastKnownPath: null,
      modifiedAt: null,
      partNumber: null,
      partSuffix: null,
      resolution: null,
      runId: null,
      scrapeOutcomeId: null,
      relativePath: `movies/${id}.mp4`,
      rootDisplayName: "Media",
      rootId: "root-1",
      size: 10,
    },
  ],
  hiddenFromRecentAt: null,
  id,
  lastRefreshedAt: null,
  mediaIdentity: id,
  number: id,
  size: 10,
  thumbnailPath: null,
  title: id,
});

describe("library availability helpers", () => {
  it.each([
    [true, true, "available"],
    [true, false, "partial"],
    [false, false, "unavailable"],
    [null, true, "unchecked"],
  ] as const)("merges movie and file availability (%s, %s)", (firstAvailable, secondAvailable, status) => {
    const first = createEntry("ABC-001");
    first.fileRefs.push({ ...first.fileRefs[0], id: "file-extra", available: true });
    const second = createEntry("ABC-002");
    const responses: LibraryAvailabilityResponse[] = [
      {
        entries: [
          {
            available: libraryAvailability([{ available: firstAvailable }, { available: secondAvailable }]),
            fileRefs: [
              {
                available: firstAvailable,
                availabilityError: firstAvailable === false ? "missing" : null,
                id: "file-ABC-001",
              },
              { available: secondAvailable, availabilityError: null, id: "file-extra" },
            ],
            id: "ABC-001",
          },
        ],
      },
    ];

    const merged = mergeLibraryAvailability([first, second], responses);

    expect(merged[0]).toMatchObject({
      available: status,
      fileRefs: [{ available: firstAvailable }, { available: secondAvailable }],
    });
    expect(merged[1]).toBe(second);
    expect(first.available).toBe("unchecked");
  });

  it("splits ids into bounded requests and rejects invalid sizes", () => {
    expect(chunkLibraryEntryIds(["1", "2", "3", "4", "5"], 2)).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    expect(chunkLibraryEntryIds([])).toEqual([]);
    expect(() => chunkLibraryEntryIds(["1"], 0)).toThrow(RangeError);
  });
});
