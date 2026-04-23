import type { MediaCandidate } from "@shared/types";
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
  lastScannedExcludeDir: string;
  supportedExtensions: string[];

  setScanDir: (scanDir: string) => void;
  setTargetDir: (targetDir: string) => void;
  beginScan: (scanDir: string, excludeDirPath?: string) => void;
  applyScanResult: (
    scanDir: string,
    excludeDirPath: string | undefined,
    candidates: MediaCandidate[],
    supportedExtensions: string[],
  ) => void;
  failScan: (scanDir: string, excludeDirPath: string | undefined, error: string) => void;
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
  lastScannedExcludeDir: "",
  supportedExtensions: [],

  setScanDir: (scanDir) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: scanDir ? "idle" : "success",
      scanError: "",
      lastScannedDir: "",
      lastScannedExcludeDir: "",
    }),

  setTargetDir: (targetDir) => set({ targetDir }),

  beginScan: (scanDir, excludeDirPath) =>
    set({
      scanDir,
      scanStatus: "scanning",
      scanError: "",
      lastScannedDir: scanDir,
      lastScannedExcludeDir: excludeDirPath ?? "",
    }),

  applyScanResult: (scanDir, excludeDirPath, candidates, supportedExtensions) =>
    set({
      scanDir,
      candidates,
      selectedPaths: candidates.map((candidate) => candidate.path),
      scanStatus: "success",
      scanError: "",
      lastScannedDir: scanDir,
      lastScannedExcludeDir: excludeDirPath ?? "",
      supportedExtensions,
    }),

  failScan: (scanDir, excludeDirPath, error) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: "error",
      scanError: error,
      lastScannedDir: scanDir,
      lastScannedExcludeDir: excludeDirPath ?? "",
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
