import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import {
  filterMediaCandidates,
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
} from "@mdcz/shared/mediaCandidate";
import { useWorkbenchSetupStore } from "@mdcz/shared/stores/workbenchSetupStore";
import type { MaintenancePresetId, MediaCandidate } from "@mdcz/shared/types";
import { WorkbenchSetupView } from "@mdcz/views/workbench";
import type { ConfigOutput } from "@renderer/client/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

const rootDir = process.platform === "win32" ? "D:\\media" : "/media";
const successDir = process.platform === "win32" ? "D:\\media\\JAV_output" : "/media/JAV_output";
const failedDir = process.platform === "win32" ? "D:\\media\\failed" : "/media/failed";
const softlinkDir = process.platform === "win32" ? "D:\\softlink" : "/softlink";

const createConfig = (overrides?: Partial<ConfigOutput>): ConfigOutput =>
  ({
    paths: {
      mediaPath: rootDir,
      successOutputFolder: "JAV_output",
      failedOutputFolder: "failed",
      defaultScanExcludeDirs: ["JAV_output", "failed"],
      softlinkPath: softlinkDir,
      outputSummaryPath: "",
    },
    behavior: {
      scrapeSoftlinkPath: true,
    },
    ...overrides,
  }) as ConfigOutput;

const createCandidate = (path: string): MediaCandidate => ({
  path,
  name: path.split(/[\\/]+/u).at(-1) ?? path,
  size: 1,
  lastModified: null,
  extension: ".mp4",
  relativePath: path,
  relativeDirectory: "",
});

const resetWorkbenchSetupStore = () => {
  useWorkbenchSetupStore.setState({
    scanDir: "",
    targetDir: "",
    candidates: [],
    selectedPaths: [],
    scanStatus: "idle",
    scanError: "",
    lastScannedDir: "",
    lastScannedPlanKey: "",
    supportedExtensions: [],
  });
};

describe("workbench setup contract", () => {
  beforeEach(() => {
    resetWorkbenchSetupStore();
  });

  it("plans normal scrape scans from configured paths and excludes output folders", () => {
    const plan = resolveMediaCandidateScanPlan("scrape", rootDir, createConfig());

    expect(plan.excludeDirPaths).toEqual([successDir, failedDir]);
    expect(plan.extraScanDirs).toEqual([softlinkDir]);
  });

  it("uses only configured scan exclude directories", () => {
    const plan = resolveMediaCandidateScanPlan(
      "scrape",
      rootDir,
      createConfig({
        paths: {
          mediaPath: rootDir,
          successOutputFolder: "JAV_output",
          failedOutputFolder: "failed",
          softlinkPath: softlinkDir,
          outputSummaryPath: "",
          defaultScanExcludeDirs: ["JAV_output", "failed", "thumbnails"],
        },
      } as Partial<ConfigOutput>),
    );

    const thumbnailsDir = process.platform === "win32" ? "D:\\media\\thumbnails" : "/media/thumbnails";
    expect(plan.excludeDirPaths).toEqual([successDir, failedDir, thumbnailsDir]);
  });

  it("does not hide the active success target when it is removed from configured exclusions", () => {
    const plan = resolveMediaCandidateScanPlan(
      "scrape",
      rootDir,
      createConfig({
        paths: {
          mediaPath: rootDir,
          successOutputFolder: "JAV_output",
          failedOutputFolder: "failed",
          softlinkPath: softlinkDir,
          outputSummaryPath: "",
          defaultScanExcludeDirs: ["failed"],
        },
      } as Partial<ConfigOutput>),
    );

    expect(plan.excludeDirPaths).toEqual([failedDir]);
  });

  it("filters output-folder candidates and dedupes merged scan roots", () => {
    const keptVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\library\\ABC-123.mp4" : "/media/library/ABC-123.mp4",
    );
    const failedVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\failed\\XYZ-999.mp4" : "/media/failed/XYZ-999.mp4",
    );
    const successVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\JAV_output\\DONE-001.mp4" : "/media/JAV_output/DONE-001.mp4",
    );
    const duplicate = createCandidate(
      process.platform === "win32" ? "D:\\MEDIA\\library\\ABC-123.mp4" : keptVideo.path,
    );
    const softlinkVideo = createCandidate(
      process.platform === "win32" ? "D:\\softlink\\SOFT-001.mp4" : "/softlink/SOFT-001.mp4",
    );

    expect(filterMediaCandidates([keptVideo, failedVideo, successVideo], [successDir, failedDir])).toEqual([keptVideo]);
    expect(mergeMediaCandidates([keptVideo], [duplicate, softlinkVideo])).toEqual([keptVideo, softlinkVideo]);
    expect(
      mergeMediaCandidates([createCandidate("D:\\media\\ABC-123.mp4")], [createCandidate("d:/MEDIA/abc-123.mp4")]),
    ).toEqual([createCandidate("D:\\media\\ABC-123.mp4")]);
  });

  it("keeps the current file list visible while a rescan is pending", () => {
    const first = createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4");
    const second = createCandidate(process.platform === "win32" ? "D:\\media\\XYZ-999.mp4" : "/media/XYZ-999.mp4");

    useWorkbenchSetupStore.getState().applyScanResult(rootDir, "", [first, second], [".mp4"]);
    useWorkbenchSetupStore.getState().toggleSelectedPath(second.path);
    useWorkbenchSetupStore.getState().beginScan(rootDir, "");

    const state = useWorkbenchSetupStore.getState();
    expect(state.scanStatus).toBe("scanning");
    expect(state.candidates).toEqual([first, second]);
    expect(state.selectedPaths).toEqual([first.path]);
  });

  it("still clears the file list immediately when the scan directory changes", () => {
    const candidate = createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4");

    useWorkbenchSetupStore.getState().applyScanResult(rootDir, "", [candidate], [".mp4"]);
    useWorkbenchSetupStore.getState().setScanDir(process.platform === "win32" ? "D:\\next-media" : "/next-media");

    const state = useWorkbenchSetupStore.getState();
    expect(state.candidates).toEqual([]);
    expect(state.selectedPaths).toEqual([]);
    expect(state.scanStatus).toBe("idle");
  });

  it("hides Web native browse buttons while keeping custom server path autocomplete inputs", () => {
    const html = renderToStaticMarkup(
      createElement(WorkbenchSetupView, {
        mode: "scrape",
        scanDir: "",
        targetDir: "",
        candidates: [],
        selectedPaths: [],
        selectedSize: 0,
        totalSize: 0,
        extensionCount: 0,
        scanStatus: "idle",
        scanning: false,
        startPending: false,
        supportedExtensions: [".mp4"],
        presetId: "read_local",
        runSummary: "",
        primaryDisabled: true,
        isServer: true,
        formatBytes: () => "0 B",
        onBrowseScanDir: () => undefined,
        onBrowseTargetDir: () => undefined,
        onRefreshScan: () => undefined,
        onPresetChange: () => undefined,
        onStart: () => undefined,
        onToggleCandidate: () => undefined,
        onToggleAll: () => undefined,
        onScanDirChange: () => undefined,
        onTargetDirChange: () => undefined,
        onSuggestScanDir: async () => ({
          path: "",
          parentPath: "",
          exists: false,
          accessible: true,
          entries: [],
        }),
        onSuggestTargetDir: async () => ({
          path: "",
          parentPath: "",
          exists: false,
          accessible: true,
          entries: [],
        }),
      }),
    );

    expect(html).not.toContain(">浏览<");
    expect(html).not.toContain("<datalist");
    expect(html.match(/aria-autocomplete="list"/g)?.length).toBe(2);
  });

  it("renders unique maintenance preset branches for all four presets", () => {
    const renderPreset = (presetId: MaintenancePresetId) =>
      renderToStaticMarkup(
        createElement(WorkbenchSetupView, {
          mode: "maintenance",
          scanDir: rootDir,
          targetDir: successDir,
          candidates: [createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4")],
          selectedPaths: [process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4"],
          selectedSize: 1,
          totalSize: 1,
          extensionCount: 1,
          scanStatus: "success",
          scanning: false,
          startPending: false,
          supportedExtensions: [".mp4"],
          presetId,
          runSummary: "1 个文件",
          primaryDisabled: false,
          isServer: false,
          formatBytes: () => "1 B",
          onBrowseScanDir: () => undefined,
          onBrowseTargetDir: () => undefined,
          onRefreshScan: () => undefined,
          onPresetChange: () => undefined,
          onStart: () => undefined,
          onToggleCandidate: () => undefined,
          onToggleAll: () => undefined,
          onScanDirChange: () => undefined,
          onTargetDirChange: () => undefined,
        }),
      );

    expect(MAINTENANCE_PRESET_OPTIONS.map((option) => option.id)).toEqual([
      "read_local",
      "refresh_data",
      "organize_files",
      "rebuild_all",
    ]);

    for (const option of MAINTENANCE_PRESET_OPTIONS) {
      const html = renderPreset(option.id);
      expect(html).toContain("维护预设");
      expect(html).toContain(option.label);
      expect(html).toContain(option.description);
    }

    const refreshHtml = renderPreset("refresh_data");
    const rebuildHtml = renderPreset("rebuild_all");
    const organizeHtml = renderPreset("organize_files");
    const readLocalHtml = renderPreset("read_local");

    expect(refreshHtml).toContain("联网刷新元数据，对比NFO差异");
    expect(rebuildHtml).toContain("重新获取数据并按现有设置修改目录结构");
    expect(organizeHtml).toContain("按规则重新组织文件目录结构");
    expect(readLocalHtml).toContain("扫描本地文件，读取现有 NFO 与资源状态");
    expect(refreshHtml).not.toEqual(rebuildHtml);
    expect(organizeHtml).not.toEqual(readLocalHtml);
  });
});
