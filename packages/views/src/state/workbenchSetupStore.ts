import type { MediaCandidate } from "@mdcz/shared/types";
import { create } from "zustand";

export type WorkbenchSetupScanStatus = "idle" | "scanning" | "success" | "error";

interface WorkbenchSetupState {
  scanDir: string;
  targetDir: string;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  scanStatus: WorkbenchSetupScanStatus;
  scanError: string;
  lastScannedDir: string;
  lastScannedPlanKey: string;
  supportedExtensions: string[];

  setScanDir: (scanDir: string) => void;
  setTargetDir: (targetDir: string) => void;
  beginScan: (scanDir: string, planKey?: string) => void;
  applyScanResult: (
    scanDir: string,
    planKey: string | undefined,
    candidates: MediaCandidate[],
    supportedExtensions: string[],
  ) => void;
  failScan: (scanDir: string, planKey: string | undefined, error: string) => void;
  toggleSelectedPath: (path: string) => void;
  setAllSelected: (selected: boolean) => void;
}

export const useWorkbenchSetupStore = create<WorkbenchSetupState>((set) => ({
  scanDir: "",
  targetDir: "",
  candidates: [],
  selectedPaths: [],
  scanStatus: "idle",
  scanError: "",
  lastScannedDir: "",
  lastScannedPlanKey: "",
  supportedExtensions: [],

  setScanDir: (scanDir) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: scanDir ? "idle" : "success",
      scanError: "",
      lastScannedDir: "",
      lastScannedPlanKey: "",
    }),

  setTargetDir: (targetDir) => set({ targetDir }),

  beginScan: (scanDir, planKey) =>
    set({
      scanDir,
      scanStatus: "scanning",
      scanError: "",
      lastScannedDir: scanDir,
      lastScannedPlanKey: planKey ?? "",
    }),

  applyScanResult: (scanDir, planKey, candidates, supportedExtensions) =>
    set({
      scanDir,
      candidates,
      selectedPaths: candidates.map((candidate) => candidate.path),
      scanStatus: "success",
      scanError: "",
      lastScannedDir: scanDir,
      lastScannedPlanKey: planKey ?? "",
      supportedExtensions,
    }),

  failScan: (scanDir, planKey, error) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: "error",
      scanError: error,
      lastScannedDir: scanDir,
      lastScannedPlanKey: planKey ?? "",
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
