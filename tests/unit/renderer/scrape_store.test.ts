import { Website } from "@mdcz/shared/enums";
import type { FileInfo, ScrapeResult } from "@mdcz/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAmbiguousUncensoredScrapeGroups,
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  buildUncensoredConfirmItemsForScrapeGroups,
  summarizeUncensoredConfirmResultForScrapeGroups,
} from "@/lib/scrapeResultGrouping";
import { useScrapeStore } from "@/store/scrapeStore";

afterEach(() => {
  useScrapeStore.getState().reset();
});

const getFileNameFromPath = (filePath: string): string => {
  const slashIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath;
};

const createScrapeResult = (input: {
  fileId: string;
  filePath: string;
  number: string;
  assets?: ScrapeResult["assets"];
  crawlerData?: ScrapeResult["crawlerData"];
  error?: string;
  nfoPath?: string;
  outputPath?: string;
  part?: FileInfo["part"];
  status?: ScrapeResult["status"];
  uncensoredAmbiguous?: boolean;
}): ScrapeResult => ({
  fileId: input.fileId,
  status: input.status ?? "success",
  fileInfo: {
    filePath: input.filePath,
    fileName: getFileNameFromPath(input.filePath),
    extension: ".mp4",
    number: input.number,
    isSubtitled: false,
    part: input.part,
  },
  crawlerData:
    input.crawlerData ??
    ({
      title: input.number,
      number: input.number,
      actors: [],
      genres: [],
      scene_images: [],
      website: Website.DMM,
    } satisfies NonNullable<ScrapeResult["crawlerData"]>),
  assets: input.assets,
  error: input.error,
  outputPath: input.outputPath,
  nfoPath: input.nfoPath,
  uncensoredAmbiguous: input.uncensoredAmbiguous,
});

describe("useScrapeStore.resolveUncensoredResults", () => {
  it("updates matched results and derives output directories from renamed target video paths", () => {
    const results: ScrapeResult[] = [
      createScrapeResult({
        fileId: "unix-item",
        number: "ABC-123",
        filePath: "/source/ABC-123.mp4",
        outputPath: "/source",
        nfoPath: "/source/ABC-123.nfo",
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "windows-item",
        number: "XYZ-789",
        filePath: "C:\\source\\XYZ-789.mp4",
        outputPath: "C:\\source",
        nfoPath: "C:\\source\\XYZ-789.nfo",
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "untouched-item",
        number: "KEEP-001",
        filePath: "/keep/KEEP-001.mp4",
        outputPath: "/keep",
        nfoPath: "/keep/KEEP-001.nfo",
        uncensoredAmbiguous: true,
      }),
    ];

    useScrapeStore.setState({ results });
    useScrapeStore.getState().resolveUncensoredResults([
      {
        fileId: "unix-item",
        sourceVideoPath: "/source/ABC-123.mp4",
        sourceNfoPath: "/source/ABC-123.nfo",
        targetVideoPath: "/library/uncensored/ABC-123.mp4",
        targetNfoPath: "/library/uncensored/ABC-123.nfo",
        choice: "uncensored",
      },
      {
        fileId: "windows-item",
        sourceVideoPath: "C:\\source\\XYZ-789.mp4",
        sourceNfoPath: "C:\\source\\XYZ-789.nfo",
        targetVideoPath: "D:\\library\\leak\\XYZ-789.mp4",
        targetNfoPath: "D:\\library\\leak\\XYZ-789.nfo",
        choice: "leak",
      },
    ]);

    expect(useScrapeStore.getState().results).toEqual([
      createScrapeResult({
        fileId: "unix-item",
        number: "ABC-123",
        filePath: "/library/uncensored/ABC-123.mp4",
        outputPath: "/library/uncensored",
        nfoPath: "/library/uncensored/ABC-123.nfo",
        uncensoredAmbiguous: false,
      }),
      createScrapeResult({
        fileId: "windows-item",
        number: "XYZ-789",
        filePath: "D:\\library\\leak\\XYZ-789.mp4",
        outputPath: "D:/library/leak",
        nfoPath: "D:\\library\\leak\\XYZ-789.nfo",
        uncensoredAmbiguous: false,
      }),
      createScrapeResult({
        fileId: "untouched-item",
        number: "KEEP-001",
        filePath: "/keep/KEEP-001.mp4",
        outputPath: "/keep",
        nfoPath: "/keep/KEEP-001.nfo",
        uncensoredAmbiguous: true,
      }),
    ]);
  });

  it("updates multipart raw results independently when each source path is returned", () => {
    const results: ScrapeResult[] = [
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        uncensoredAmbiguous: true,
      }),
    ];

    useScrapeStore.setState({ results });
    useScrapeStore.getState().resolveUncensoredResults([
      {
        fileId: "part-1",
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "uncensored",
      },
      {
        fileId: "part-2",
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "uncensored",
      },
    ]);

    expect(useScrapeStore.getState().results).toEqual([
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456-UMR",
        nfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        uncensoredAmbiguous: false,
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456-UMR",
        nfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        uncensoredAmbiguous: false,
      }),
    ]);
  });
});

describe("useScrapeStore.addResult", () => {
  it("stores raw results without merging multipart entries in the store", () => {
    const store = useScrapeStore.getState();

    store.addResult(
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 1,
          suffix: "-cd1",
        },
        crawlerData: {
          title: "Multipart Title",
          number: "FC2-123456",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.DMM,
        },
        assets: {
          sceneImages: ["/library/FC2-123456/extrafanart/fanart1.jpg"],
          downloaded: [],
        },
      }),
    );
    store.addResult(
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 2,
          suffix: "-cd2",
        },
        crawlerData: {
          title: "Multipart Title",
          number: "FC2-123456",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.DMM,
        },
        assets: {
          sceneImages: ["/library/FC2-123456/extrafanart/fanart1.jpg", "/library/FC2-123456/extrafanart/fanart2.jpg"],
          downloaded: [],
        },
      }),
    );

    expect(useScrapeStore.getState().results).toHaveLength(2);
  });
});

describe("buildScrapeResultGroups", () => {
  it("preserves the original normal-scrape grouping behavior for same-directory same-number successes", () => {
    const groups = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "first",
        number: "ABC-123",
        filePath: "/library/ABC-123/ABC-123-copy-a.mp4",
        outputPath: "/library/ABC-123",
        crawlerData: {
          title: "Same Number",
          number: "ABC-123",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.DMM,
        },
      }),
      createScrapeResult({
        fileId: "second",
        number: "ABC-123",
        filePath: "/library/ABC-123/ABC-123-copy-b.mp4",
        outputPath: "/library/ABC-123",
        crawlerData: {
          title: "Same Number",
          number: "ABC-123",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.DMM,
        },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "/library/ABC-123::ABC-123",
      items: [{ fileId: "first" }, { fileId: "second" }],
      display: {
        fileId: "first",
        fileInfo: {
          number: "ABC-123",
        },
        outputPath: "/library/ABC-123",
      },
    });
  });

  it("keeps the same group key when an earlier multipart part arrives later", () => {
    const lateFirstPart = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "second",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        part: {
          number: 2,
          suffix: "-cd2",
        },
      }),
    ]);
    const completedGroup = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "second",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        part: {
          number: 2,
          suffix: "-cd2",
        },
      }),
      createScrapeResult({
        fileId: "first",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        part: {
          number: 1,
          suffix: "-cd1",
        },
      }),
    ]);

    expect(lateFirstPart[0]?.id).toBe("/library/FC2-123456::FC2-123456");
    expect(completedGroup[0]?.id).toBe("/library/FC2-123456::FC2-123456");
    expect(completedGroup[0]?.representative.fileId).toBe("first");
  });

  it("collapses same-directory same-number results into one failed group when any child fails", () => {
    const groups = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "success",
        number: "ABC-123",
        filePath: "/library/ABC-123/ABC-123.mp4",
        outputPath: "/library/ABC-123",
      }),
      createScrapeResult({
        fileId: "failed",
        status: "failed",
        number: "ABC-123",
        filePath: "/library/ABC-123/ABC-123-failed.mp4",
        outputPath: "/library/ABC-123",
        error: "failed",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "/library/ABC-123::ABC-123",
      status: "failed",
      errorText: "failed",
      items: [{ fileId: "failed" }, { fileId: "success" }],
    });
  });

  it("builds grouped action targets from every raw file in a multipart result", () => {
    const [group] = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 1,
          suffix: "-cd1",
        },
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 2,
          suffix: "-cd2",
        },
      }),
    ]);

    expect(buildScrapeResultGroupActionContext(group, null)).toEqual({
      selectedItem: expect.objectContaining({
        fileId: "part-1",
      }),
      nfoPath: "/library/FC2-123456/FC2-123456.nfo",
      videoPaths: ["/library/FC2-123456/FC2-123456-cd1.mp4", "/library/FC2-123456/FC2-123456-cd2.mp4"],
    });
  });

  it("expands grouped uncensored confirmation to all raw files in the group", () => {
    const groups = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      }),
    ]);

    expect(buildUncensoredConfirmItemsForScrapeGroups(groups, { [groups[0]?.id ?? ""]: "leak" })).toEqual([
      {
        fileId: "part-1",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        choice: "leak",
      },
      {
        fileId: "part-2",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        choice: "leak",
      },
    ]);
  });

  it("keeps partially resolved multipart groups visible and only resubmits unresolved files", () => {
    const groups = buildAmbiguousUncensoredScrapeGroups([
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: false,
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(buildUncensoredConfirmItemsForScrapeGroups(groups, { [groups[0]?.id ?? ""]: "uncensored" })).toEqual([
      {
        fileId: "part-2",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        choice: "uncensored",
      },
    ]);
    expect(
      summarizeUncensoredConfirmResultForScrapeGroups(groups, [
        {
          fileId: "part-2",
          sourceVideoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
          sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
          targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
          targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
          choice: "uncensored",
        },
      ]),
    ).toEqual({
      successCount: 1,
      failedCount: 0,
    });
  });

  it("summarizes uncensored confirmation by grouped entry instead of raw file count", () => {
    const groups = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "part-2",
        number: "FC2-123456",
        filePath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        part: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      }),
    ]);

    expect(
      summarizeUncensoredConfirmResultForScrapeGroups(groups, [
        {
          fileId: "part-1",
          sourceVideoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
          sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
          targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
          targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
          choice: "uncensored",
        },
      ]),
    ).toEqual({
      successCount: 0,
      failedCount: 1,
    });
  });
});
