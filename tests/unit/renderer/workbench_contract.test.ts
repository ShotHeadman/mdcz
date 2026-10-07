import { resolveMediaCandidateScanPlan } from "@mdcz/shared/mediaCandidate";
import type { MediaCandidate } from "@mdcz/shared/types";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import type { ConfigOutput } from "@renderer/client/types";
import { beforeEach, describe, expect, it } from "vitest";

const rootDir = process.platform === "win32" ? "D:\\media" : "/media";
const successDir = process.platform === "win32" ? "D:\\media\\JAV_output" : "/media/JAV_output";

const createConfig = (defaultScanExcludeDirs = ["JAV_output"]): ConfigOutput =>
  ({ paths: { defaultScanExcludeDirs } }) as unknown as ConfigOutput;

const createCandidate = (path: string): MediaCandidate => ({
  path,
  name: path.split(/[\\/]+/u).at(-1) ?? path,
  size: 1,
  lastModified: null,
  extension: ".mp4",
  ref: { rootId: "test-root", relativePath: path.split(/[\\/]+/u).at(-1) ?? path },
});

const resetWorkbenchSetupStore = () => {
  useWorkbenchSetupStore.setState({
    scanDir: "",
    recursive: false,
    committedPlanKey: null,
    warnings: { count: 0, paths: [] },
    candidates: [],
    selectedPaths: [],
    scanStatus: "idle",
    scanError: "",
    supportedExtensions: [],
  });
};

describe("workbench setup contract", () => {
  beforeEach(() => {
    resetWorkbenchSetupStore();
  });

  it("plans scrape scans that skip only the configured exclude directories", () => {
    const plan = resolveMediaCandidateScanPlan("scrape", rootDir, false, createConfig());
    const thumbnailsDir = process.platform === "win32" ? "D:\\media\\thumbnails" : "/media/thumbnails";

    expect(plan.excludeDirPaths).toEqual([successDir]);
    expect(plan.recursive).toBe(false);
    expect(resolveMediaCandidateScanPlan("scrape", rootDir, true, createConfig()).scanKey).not.toBe(plan.scanKey);
    expect(resolveMediaCandidateScanPlan("maintenance", rootDir, false, createConfig()).scanKey).not.toBe(plan.scanKey);
    expect(
      resolveMediaCandidateScanPlan("scrape", rootDir, false, createConfig(["JAV_output", "thumbnails"]))
        .excludeDirPaths,
    ).toEqual([successDir, thumbnailsDir]);
    expect(resolveMediaCandidateScanPlan("scrape", rootDir, false, createConfig([])).excludeDirPaths).toEqual([]);
  });

  it("keeps the current file list visible while a rescan is pending", () => {
    const first = createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4");
    const second = createCandidate(process.platform === "win32" ? "D:\\media\\XYZ-999.mp4" : "/media/XYZ-999.mp4");

    useWorkbenchSetupStore.getState().setScanDir(rootDir);
    useWorkbenchSetupStore.getState().applyScanResult("", [first, second], [".mp4"]);
    useWorkbenchSetupStore.getState().toggleSelectedPath(second.path);
    const committed = useWorkbenchSetupStore.getState();
    committed.setScanDir(`${rootDir}/`);
    expect(useWorkbenchSetupStore.getState()).toBe(committed);
    expect(resolveMediaCandidateScanPlan("scrape", `${rootDir}/`, false, createConfig()).scanKey).toBe(
      resolveMediaCandidateScanPlan("scrape", rootDir, false, createConfig()).scanKey,
    );
    useWorkbenchSetupStore.getState().beginScan();

    const state = useWorkbenchSetupStore.getState();
    expect(state.scanStatus).toBe("scanning");
    expect(state.candidates).toEqual([first, second]);
    expect(state.selectedPaths).toEqual([first.path]);
    const added = createCandidate(`${rootDir}/NEW-001.mp4`);
    state.applyScanResult("", [first, second, added], [".mp4"]);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([first.path]);
    state.applyScanResult("", [second, added], [".mp4"]);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([]);
    state.beginScan();
    state.failScan("temporary failure");
    state.beginScan();
    state.applyScanResult("recursive", [second, added], [".mp4"]);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([second.path, added.path]);
    state.setPathsSelected([second.path], false);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([added.path]);
    state.setPathsSelected([second.path, "missing.mp4"], true);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([second.path, added.path]);
    state.setPathsSelected([], false);
    expect(useWorkbenchSetupStore.getState().selectedPaths).toEqual([second.path, added.path]);
  });

  it("still clears the file list immediately when the scan directory changes", () => {
    useWorkbenchSetupStore.getState().setScanDir("/");
    expect(useWorkbenchSetupStore.getState().scanDir).toBe("/");
    const candidate = createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4");

    useWorkbenchSetupStore.getState().applyScanResult("", [candidate], [".mp4"]);
    useWorkbenchSetupStore.getState().setScanDir(process.platform === "win32" ? "D:\\next-media" : "/next-media");

    const state = useWorkbenchSetupStore.getState();
    expect(state.candidates).toEqual([]);
    expect(state.selectedPaths).toEqual([]);
    expect(state.scanStatus).toBe("idle");
  });
});
