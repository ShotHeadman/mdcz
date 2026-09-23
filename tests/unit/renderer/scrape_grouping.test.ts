import type { ScrapeResult } from "@mdcz/shared/types";
import {
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { describe, expect, it } from "vitest";

const createScrapeResult = (overrides: Partial<ScrapeResult> = {}): ScrapeResult => ({
  fileId: "part-1",
  rootId: "root-1",
  relativePath: "FC2-123456/FC2-123456-cd1.mp4",
  fileName: "FC2-123456-cd1.mp4",
  status: "success",
  assets: [],
  sources: {},
  crawlerData: {
    number: "FC2-123456",
    title: "FC2 Title",
    actors: [],
    genres: [],
    scene_images: [],
  },
  output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd1.mp4" },
  nfo: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456.nfo" },
  ...overrides,
});

describe("scrape result multipart grouping", () => {
  it("collapses same-directory multipart files into a single display group", () => {
    const part1 = createScrapeResult({
      fileId: "part-1",
      fileName: "FC2-123456-cd1.mp4",
      relativePath: "FC2-123456/FC2-123456-cd1.mp4",
      part: { number: 1, suffix: "-cd1" },
      crawlerData: { number: "FC2-123456", title: "FC2 Title", actors: ["Actor A"], genres: [], scene_images: [] },
      output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd1.mp4" },
    });
    const part2 = createScrapeResult({
      fileId: "part-2",
      fileName: "FC2-123456-cd2.mp4",
      relativePath: "FC2-123456/FC2-123456-cd2.mp4",
      part: { number: 2, suffix: "-cd2" },
      crawlerData: {
        number: "FC2-123456",
        title: "FC2 Title",
        actors: ["Actor A", "Actor B"],
        genres: [],
        scene_images: [],
      },
      output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd2.mp4" },
    });
    const standalone = createScrapeResult({
      fileId: "standalone-1",
      fileName: "ABC-123.mp4",
      relativePath: "ABC-123/ABC-123.mp4",
      crawlerData: { number: "ABC-123", title: "ABC Title", actors: [], genres: [], scene_images: [] },
      output: { rootId: "root-1", relativePath: "ABC-123/ABC-123.mp4" },
    });

    const groups = buildScrapeResultGroups([part1, standalone, part2]);

    expect(groups).toHaveLength(2);
    const multiGroup = groups.find((group) => group.items.length === 2);
    expect(multiGroup).toBeDefined();
    expect(multiGroup?.items.map((item) => item.fileId)).toEqual(["part-1", "part-2"]);
    expect(multiGroup?.display.crawlerData?.actors).toEqual(["Actor A", "Actor B"]);
  });

  it("builds group action context with unified targets and NFO path", () => {
    const [group] = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        fileName: "FC2-123456-cd1.mp4",
        relativePath: "FC2-123456/FC2-123456-cd1.mp4",
        part: { number: 1, suffix: "-cd1" },
        output: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456-cd1.mp4" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
      }),
      createScrapeResult({
        fileId: "part-2",
        fileName: "FC2-123456-cd2.mp4",
        relativePath: "FC2-123456/FC2-123456-cd2.mp4",
        part: { number: 2, suffix: "-cd2" },
        output: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456-cd2.mp4" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
      }),
    ]);

    expect(group).toBeDefined();
    if (!group) return;

    const context = buildScrapeResultGroupActionContext(group, null);
    expect(context.selectedItem.fileId).toBe("part-1");
    expect(context.nfoPath).toBe("library/FC2-123456/FC2-123456.nfo");
    expect(context.videoPaths).toEqual([
      "library/FC2-123456/FC2-123456-cd1.mp4",
      "library/FC2-123456/FC2-123456-cd2.mp4",
    ]);
  });
});
