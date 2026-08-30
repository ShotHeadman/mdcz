import type { LocalScanEntry } from "@mdcz/shared/types";
import {
  buildMaintenanceEntryGroups,
  buildMaintenanceEntryViewModel,
  countMaintenanceDisplayItems,
  formatMaintenanceIdleStatusText,
  summarizeMaintenanceExecutionGroups,
} from "@mdcz/shared/viewModels/maintenanceGrouping";
import { describe, expect, it } from "vitest";
import {
  createMaintenanceCrawlerData,
  createMaintenanceEntry,
  createMaintenanceValueDiff,
} from "./maintenanceTestSupport";

describe("maintenance multipart grouping", () => {
  it("collapses same-directory multipart files into one display group", () => {
    const part1: LocalScanEntry = {
      ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "FC2-123456" })),
      fileId: "entry-1",
      fileInfo: {
        filePath: "/media/FC2-123456-1.mp4",
        fileName: "FC2-123456-1",
        extension: ".mp4",
        number: "FC2-123456",
        isSubtitled: false,
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };
    const standalone: LocalScanEntry = {
      ...createMaintenanceEntry(createMaintenanceCrawlerData({ number: "ABC-123" })),
      fileId: "entry-3",
    };

    const groups = buildMaintenanceEntryGroups([part2, standalone, part1]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.representative.fileId === "entry-3")).toMatchObject({
      representative: standalone,
    });
    expect(groups.find((group) => group.items.length === 2)?.items.map((entry) => entry.fileId)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(formatMaintenanceIdleStatusText([part1, part2])).toBe("已扫描 1 项");
  });

  it("marks the whole group as failed immediately when any child file fails", () => {
    const part1: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    const [group] = buildMaintenanceEntryGroups([part1, part2], {
      itemResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "processing",
        },
        "entry-2": {
          fileId: "entry-2",
          status: "failed",
          error: "第二个分盘维护失败",
        },
      },
    });

    expect(group?.status).toBe("failed");
    expect(group?.errorText).toBe("第二个分盘维护失败");
    expect(group?.compareResult).toMatchObject({
      fileId: "entry-2",
      status: "failed",
      error: "第二个分盘维护失败",
    });
  });

  it("treats a ready preview as the effective status when local scanError has been recovered", () => {
    const entry: LocalScanEntry = {
      ...createMaintenanceEntry(),
      scanError: "NFO 解析失败: NFO missing website",
      crawlerData: undefined,
    };

    const [group] = buildMaintenanceEntryGroups([entry], {
      previewResults: {
        [entry.fileId]: {
          fileId: entry.fileId,
          status: "ready",
        },
      },
    });

    expect(group?.status).toBe("success");
    expect(group?.errorText).toBeUndefined();
  });

  it("builds a unified batch view model with grouped preview state and executable entries", () => {
    const part1: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    const viewModel = buildMaintenanceEntryViewModel([part1, part2], {
      previewResults: {
        "entry-1": {
          fileId: "entry-1",
          status: "ready",
          fieldDiffs: [
            createMaintenanceValueDiff({ field: "title", label: "标题", oldValue: "A", newValue: "B", changed: true }),
          ],
          pathDiff: {
            fileId: "entry-1",
            currentVideoPath: "/media/FC2-123456-1.mp4",
            targetVideoPath: "/organized/FC2-123456-1.mp4",
            currentDir: "/media",
            targetDir: "/organized",
            changed: true,
          },
        },
        "entry-2": {
          fileId: "entry-2",
          status: "ready",
        },
      },
    });

    expect(viewModel.previewSummary).toEqual({
      totalCount: 1,
      readyCount: 1,
      blockedCount: 0,
    });
    expect(viewModel.executableEntries.map((entry) => entry.fileId)).toEqual(["entry-1", "entry-2"]);
    expect(viewModel.groups[0]?.previewState).toMatchObject({
      ready: true,
      diffCount: 1,
      hasPathChange: true,
    });
  });

  it("summarizes execution counts by grouped movie instead of raw file count", () => {
    const part1: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-1",
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
      currentDir: "/media",
    };
    const part2: LocalScanEntry = {
      ...part1,
      fileId: "entry-2",
      fileInfo: {
        ...part1.fileInfo,
        filePath: "/media/FC2-123456-2.mp4",
        fileName: "FC2-123456-2",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };

    expect(
      summarizeMaintenanceExecutionGroups([part1, part2], {
        "entry-1": {
          fileId: "entry-1",
          status: "success",
        },
        "entry-2": {
          fileId: "entry-2",
          status: "success",
        },
      }),
    ).toEqual({
      totalCount: 1,
      completedCount: 1,
      successCount: 1,
      failedCount: 0,
      activeCount: 0,
    });
  });

  it("keeps multipart groups stable while a child entry has already moved to the target directory", () => {
    const sourceDir = "/media";
    const targetDir = "/organized/FC2-123456";
    const part1: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-1",
      currentDir: targetDir,
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        filePath: `${targetDir}/FC2-123456-1.mp4`,
        fileName: "FC2-123456-1",
        number: "FC2-123456",
        part: {
          number: 1,
          suffix: "-1",
        },
      },
    };
    const part2: LocalScanEntry = {
      ...createMaintenanceEntry(),
      fileId: "entry-2",
      currentDir: sourceDir,
      fileInfo: {
        ...createMaintenanceEntry().fileInfo,
        filePath: `${sourceDir}/FC2-123456-2.mp4`,
        fileName: "FC2-123456-2",
        number: "FC2-123456",
        part: {
          number: 2,
          suffix: "-2",
        },
      },
    };
    const itemResults = {
      "entry-1": {
        fileId: "entry-1",
        status: "success" as const,
        pathDiff: {
          fileId: "entry-1",
          currentVideoPath: `${sourceDir}/FC2-123456-1.mp4`,
          targetVideoPath: `${targetDir}/FC2-123456-1.mp4`,
          currentDir: sourceDir,
          targetDir,
          changed: true,
        },
      },
      "entry-2": {
        fileId: "entry-2",
        status: "processing" as const,
        pathDiff: {
          fileId: "entry-2",
          currentVideoPath: `${sourceDir}/FC2-123456-2.mp4`,
          targetVideoPath: `${targetDir}/FC2-123456-2.mp4`,
          currentDir: sourceDir,
          targetDir,
          changed: true,
        },
      },
    };

    expect(countMaintenanceDisplayItems([part1, part2], { itemResults })).toBe(1);
    expect(buildMaintenanceEntryGroups([part1, part2], { itemResults })).toHaveLength(1);
  });
});
