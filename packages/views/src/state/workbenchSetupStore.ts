import { normalizeComparableHostPath } from "@mdcz/shared/mediaCandidate";
import type { MediaCandidate } from "@mdcz/shared/types";
import { create } from "zustand";

export type WorkbenchSetupScanStatus = "idle" | "scanning" | "success" | "error";

interface WorkbenchSetupState {
  scanDir: string;
  recursive: boolean;
  previewMode: boolean;
  setPreviewMode: (previewMode: boolean) => void;
  committedPlanKey: string | null;
  warnings: { count: number; paths: string[] };
  setRecursive: (recursive: boolean) => void;
  targetDir: string;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  scanStatus: WorkbenchSetupScanStatus;
  scanError: string;
  supportedExtensions: string[];

  setScanDir: (scanDir: string) => void;
  setTargetDir: (targetDir: string) => void;
  beginScan: () => void;
  applyScanResult: (
    planKey: string,
    candidates: MediaCandidate[],
    supportedExtensions: string[],
    warnings?: { count: number; paths: string[] },
  ) => void;
  failScan: (error: string) => void;
  toggleSelectedPath: (path: string) => void;
  setAllSelected: (selected: boolean) => void;
}

export const useWorkbenchSetupStore = create<WorkbenchSetupState>((set) => ({
  scanDir: "",
  previewMode: false,
  setPreviewMode: (previewMode) => set({ previewMode }),
  recursive: true,
  committedPlanKey: null,
  warnings: { count: 0, paths: [] },
  setRecursive: (recursive) => set({ recursive, scanStatus: "idle" }),
  targetDir: "",
  candidates: [],
  selectedPaths: [],
  scanStatus: "idle",
  scanError: "",
  supportedExtensions: [],

  setScanDir: (scanDir) =>
    set((state) =>
      Boolean(state.scanDir.trim()) === Boolean(scanDir.trim()) &&
      normalizeComparableHostPath(state.scanDir) === normalizeComparableHostPath(scanDir)
        ? state
        : {
            scanDir,
            candidates: [],
            selectedPaths: [],
            scanStatus: "idle",
            scanError: "",
            committedPlanKey: null,
          },
    ),

  setTargetDir: (targetDir) => set({ targetDir }),

  beginScan: () =>
    set({
      scanStatus: "scanning",
      scanError: "",
    }),

  applyScanResult: (planKey, candidates, supportedExtensions, warnings) =>
    set((state) => {
      const selected = state.committedPlanKey === planKey ? new Set(state.selectedPaths) : null;
      return {
        candidates,
        selectedPaths: candidates
          .filter((candidate) => !selected || selected.has(candidate.path))
          .map((candidate) => candidate.path),
        committedPlanKey: planKey,
        warnings: warnings ?? { count: 0, paths: [] },
        scanStatus: "success",
        scanError: "",
        supportedExtensions,
      };
    }),

  failScan: (error) =>
    set({
      scanStatus: "error",
      scanError: error,
    }),

  toggleSelectedPath: (path) =>
    set((state) => ({
      selectedPaths: state.selectedPaths.includes(path)
        ? state.selectedPaths.filter((selectedPath) => selectedPath !== path)
        : [...state.selectedPaths, path],
    })),

  setAllSelected: (selected) =>
    set((state) => ({
      selectedPaths: selected ? state.candidates.map((candidate) => candidate.path) : [],
    })),
}));
