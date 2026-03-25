import { afterEach, describe, expect, it } from "vitest";
import {
  buildAmbiguousUncensoredScrapeGroups,
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  buildUncensoredConfirmItemsForScrapeGroups,
  summarizeUncensoredConfirmResultForScrapeGroups,
} from "@/lib/scrapeResultGrouping";
import type { ScrapeResult } from "@/store/scrapeStore";
import { useScrapeStore } from "@/store/scrapeStore";

afterEach(() => {
  useScrapeStore.getState().reset();
});

describe("useScrapeStore.resolveUncensoredResults", () => {
  it("updates matched results and derives output directories from renamed target video paths", () => {
    const results: ScrapeResult[] = [
      {
        id: "unix-item",
        status: "success",
        number: "ABC-123",
        path: "/source/ABC-123.mp4",
        outputPath: "/source",
        nfoPath: "/source/ABC-123.nfo",
        uncensoredAmbiguous: true,
      },
      {
        id: "windows-item",
        status: "success",
        number: "XYZ-789",
        path: "C:\\source\\XYZ-789.mp4",
        outputPath: "C:\\source",
        nfoPath: "C:\\source\\XYZ-789.nfo",
        uncensoredAmbiguous: true,
      },
      {
        id: "untouched-item",
        status: "success",
        number: "KEEP-001",
        path: "/keep/KEEP-001.mp4",
        outputPath: "/keep",
        nfoPath: "/keep/KEEP-001.nfo",
        uncensoredAmbiguous: true,
      },
    ];

    useScrapeStore.setState({ results });
    useScrapeStore.getState().resolveUncensoredResults([
      {
        sourceVideoPath: "/source/ABC-123.mp4",
        sourceNfoPath: "/source/ABC-123.nfo",
        targetVideoPath: "/library/uncensored/ABC-123.mp4",
        targetNfoPath: "/library/uncensored/ABC-123.nfo",
        choice: "uncensored",
      },
      {
        sourceVideoPath: "C:\\source\\XYZ-789.mp4",
        sourceNfoPath: "C:\\source\\XYZ-789.nfo",
        targetVideoPath: "D:\\library\\leak\\XYZ-789.mp4",
        targetNfoPath: "D:\\library\\leak\\XYZ-789.nfo",
        choice: "leak",
      },
    ]);

    expect(useScrapeStore.getState().results).toEqual([
      {
        id: "unix-item",
        status: "success",
        number: "ABC-123",
        path: "/library/uncensored/ABC-123.mp4",
        outputPath: "/library/uncensored",
        nfoPath: "/library/uncensored/ABC-123.nfo",
        multipartDirectory: "/library/uncensored",
        uncensoredAmbiguous: false,
      },
      {
        id: "windows-item",
        status: "success",
        number: "XYZ-789",
        path: "D:\\library\\leak\\XYZ-789.mp4",
        outputPath: "D:\\library\\leak",
        nfoPath: "D:\\library\\leak\\XYZ-789.nfo",
        multipartDirectory: "D:\\library\\leak",
        uncensoredAmbiguous: false,
      },
      {
        id: "untouched-item",
        status: "success",
        number: "KEEP-001",
        path: "/keep/KEEP-001.mp4",
        outputPath: "/keep",
        nfoPath: "/keep/KEEP-001.nfo",
        uncensoredAmbiguous: true,
      },
    ]);
  });

  it("updates multipart raw results independently when each source path is returned", () => {
    const results: ScrapeResult[] = [
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        uncensoredAmbiguous: true,
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        uncensoredAmbiguous: true,
      },
    ];

    useScrapeStore.setState({ results });
    useScrapeStore.getState().resolveUncensoredResults([
      {
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "uncensored",
      },
      {
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "uncensored",
      },
    ]);

    expect(useScrapeStore.getState().results).toEqual([
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456-UMR",
        nfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456-UMR",
        uncensoredAmbiguous: false,
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456-UMR",
        nfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456-UMR",
        uncensoredAmbiguous: false,
      },
    ]);
  });
});

describe("useScrapeStore.addResult", () => {
  it("stores raw results without merging multipart entries in the store", () => {
    const store = useScrapeStore.getState();

    store.addResult({
      id: "part-1",
      status: "success",
      number: "FC2-123456",
      title: "Multipart Title",
      path: "/library/FC2-123456/FC2-123456-cd1.mp4",
      outputPath: "/library/FC2-123456",
      nfoPath: "/library/FC2-123456/FC2-123456.nfo",
      multipartDirectory: "/library/FC2-123456",
      multipartPart: {
        number: 1,
        suffix: "-cd1",
      },
      sceneImages: ["/library/FC2-123456/extrafanart/fanart1.jpg"],
    });
    store.addResult({
      id: "part-2",
      status: "success",
      number: "FC2-123456",
      title: "Multipart Title",
      path: "/library/FC2-123456/FC2-123456-cd2.mp4",
      outputPath: "/library/FC2-123456",
      nfoPath: "/library/FC2-123456/FC2-123456.nfo",
      multipartDirectory: "/library/FC2-123456",
      multipartPart: {
        number: 2,
        suffix: "-cd2",
      },
      sceneImages: ["/library/FC2-123456/extrafanart/fanart1.jpg", "/library/FC2-123456/extrafanart/fanart2.jpg"],
    });

    expect(useScrapeStore.getState().results).toHaveLength(2);
  });
});

describe("buildScrapeResultGroups", () => {
  it("preserves the original normal-scrape grouping behavior for same-directory same-number successes", () => {
    const groups = buildScrapeResultGroups([
      {
        id: "first",
        status: "success",
        number: "ABC-123",
        title: "Same Number",
        path: "/library/ABC-123/ABC-123-copy-a.mp4",
        outputPath: "/library/ABC-123",
        multipartDirectory: "/library/ABC-123",
      },
      {
        id: "second",
        status: "success",
        number: "ABC-123",
        title: "Same Number",
        path: "/library/ABC-123/ABC-123-copy-b.mp4",
        outputPath: "/library/ABC-123",
        multipartDirectory: "/library/ABC-123",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "/library/ABC-123::ABC-123",
      items: [
        {
          id: "first",
        },
        {
          id: "second",
        },
      ],
      display: {
        id: "first",
        number: "ABC-123",
        outputPath: "/library/ABC-123",
      },
    });
  });

  it("keeps the same group key when an earlier multipart part arrives later", () => {
    const lateFirstPart = buildScrapeResultGroups([
      {
        id: "second",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
      },
    ]);
    const completedGroup = buildScrapeResultGroups([
      {
        id: "second",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
      },
      {
        id: "first",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 1,
          suffix: "-cd1",
        },
      },
    ]);

    expect(lateFirstPart[0]?.id).toBe("/library/FC2-123456::FC2-123456");
    expect(completedGroup[0]?.id).toBe("/library/FC2-123456::FC2-123456");
    expect(completedGroup[0]?.representative.id).toBe("first");
  });

  it("does not collapse failed items into successful grouped results", () => {
    const groups = buildScrapeResultGroups([
      {
        id: "success",
        status: "success",
        number: "ABC-123",
        path: "/library/ABC-123/ABC-123.mp4",
        outputPath: "/library/ABC-123",
        multipartDirectory: "/library/ABC-123",
      },
      {
        id: "failed",
        status: "failed",
        number: "ABC-123",
        path: "/library/ABC-123/ABC-123-failed.mp4",
        outputPath: "/library/ABC-123",
        multipartDirectory: "/library/ABC-123",
        errorMessage: "failed",
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.id)).toEqual(["/library/ABC-123::ABC-123", "standalone:failed"]);
  });

  it("builds grouped action targets from every raw file in a multipart result", () => {
    const [group] = buildScrapeResultGroups([
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 1,
          suffix: "-cd1",
        },
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
      },
    ]);

    expect(buildScrapeResultGroupActionContext(group, null)).toEqual({
      selectedItem: expect.objectContaining({
        id: "part-1",
      }),
      nfoPath: "/library/FC2-123456/FC2-123456.nfo",
      videoPaths: ["/library/FC2-123456/FC2-123456-cd1.mp4", "/library/FC2-123456/FC2-123456-cd2.mp4"],
    });
  });

  it("expands grouped uncensored confirmation to all raw files in the group", () => {
    const groups = buildScrapeResultGroups([
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: true,
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      },
    ]);

    expect(buildUncensoredConfirmItemsForScrapeGroups(groups, { [groups[0]?.id ?? ""]: "leak" })).toEqual([
      {
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        choice: "leak",
      },
      {
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        choice: "leak",
      },
    ]);
  });

  it("keeps partially resolved multipart groups visible and only resubmits unresolved files", () => {
    const groups = buildAmbiguousUncensoredScrapeGroups([
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: false,
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(buildUncensoredConfirmItemsForScrapeGroups(groups, { [groups[0]?.id ?? ""]: "uncensored" })).toEqual([
      {
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        videoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        choice: "uncensored",
      },
    ]);
    expect(
      summarizeUncensoredConfirmResultForScrapeGroups(groups, [
        {
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
      {
        id: "part-1",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd1.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 1,
          suffix: "-cd1",
        },
        uncensoredAmbiguous: true,
      },
      {
        id: "part-2",
        status: "success",
        number: "FC2-123456",
        path: "/library/FC2-123456/FC2-123456-cd2.mp4",
        outputPath: "/library/FC2-123456",
        nfoPath: "/library/FC2-123456/FC2-123456.nfo",
        multipartDirectory: "/library/FC2-123456",
        multipartPart: {
          number: 2,
          suffix: "-cd2",
        },
        uncensoredAmbiguous: true,
      },
    ]);

    expect(
      summarizeUncensoredConfirmResultForScrapeGroups(groups, [
        {
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
