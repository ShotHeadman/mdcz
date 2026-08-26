import { buildFileId, normalizePathForIdentity } from "@mdcz/shared/mediaIdentity";
import type { ScrapeResult as SharedScrapeResult, UncensoredConfirmResultItem } from "@mdcz/shared/types";
import { deriveGroupingDirectoryFromPath } from "@mdcz/shared/viewModels/multipartDisplay";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ScrapeResult = SharedScrapeResult;

interface ScrapeState {
  isScraping: boolean;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  progress: number;
  total: number;
  current: number;
  failedCount: number;
  results: ScrapeResult[];

  setScraping: (isScraping: boolean) => void;
  setScrapeStatus: (status: "idle" | "running" | "stopping" | "paused") => void;
  updateProgress: (current: number, total: number, percent?: number) => void;
  setProgressPercent: (percent: number) => void;
  upsertResult: (result: ScrapeResult) => void;
  addResult: (result: ScrapeResult) => void;
  replaceResults: (results: ScrapeResult[]) => void;
  seedProcessingResults: (filePaths: string[]) => void;
  failUnfinishedResults: (reason: string) => void;
  markResultsRetrying: (filePaths: string[]) => void;
  clearResults: () => void;
  setFailedCount: (count: number) => void;
  resolveUncensoredResults: (updates: UncensoredConfirmResultItem[]) => void;
  reset: () => void;
}

// 开发环境下启用 HMR 状态持久化
const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const getFileNameFromPath = (filePath: string): string => {
  const slashIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath;
};
const getExtensionFromFileName = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex) : "";
};

const storeCreator: StateCreator<ScrapeState> = (set) => ({
  isScraping: false,
  scrapeStatus: "idle",
  progress: 0,
  total: 0,
  current: 0,
  failedCount: 0,
  results: [],

  setScraping: (isScraping) => set({ isScraping }),
  setScrapeStatus: (status) => set({ scrapeStatus: status }),
  updateProgress: (current, total, percent) =>
    set({
      current,
      total,
      progress: percent ?? (total > 0 ? (current / total) * 100 : 0),
    }),
  setProgressPercent: (percent) => set({ progress: Math.min(100, Math.max(0, percent)) }),
  addResult: (result) =>
    set((state) => ({
      results: [...state.results, result],
    })),
  upsertResult: (result) =>
    set((state) => {
      const existingIndex = state.results.findIndex((item) => item.fileId === result.fileId);
      if (existingIndex === -1) {
        return { results: [...state.results, result] };
      }
      const nextResults = [...state.results];
      nextResults[existingIndex] = result;
      return { results: nextResults };
    }),
  replaceResults: (results) =>
    set({
      results: [...results],
      failedCount: results.filter((result) => result.status === "failed").length,
    }),
  seedProcessingResults: (filePaths) =>
    set({
      results: filePaths.map((filePath) => {
        const fileName = getFileNameFromPath(filePath);
        return {
          fileId: buildFileId(filePath),
          fileInfo: {
            filePath,
            fileName,
            extension: getExtensionFromFileName(fileName),
            number: "",
            isSubtitled: false,
          },
          status: "processing",
        };
      }),
      failedCount: 0,
    }),
  failUnfinishedResults: (reason) =>
    set((state) => {
      const results = state.results.map((result) =>
        result.status === "processing" || result.status === "pending"
          ? { ...result, status: "failed" as const, error: reason }
          : result,
      );
      return {
        results,
        failedCount: results.filter((result) => result.status === "failed").length,
      };
    }),
  clearResults: () =>
    set({
      results: [],
      failedCount: 0,
    }),
  markResultsRetrying: (filePaths) =>
    set((state) => {
      const retryPaths = new Set(filePaths.map((filePath) => normalizePathForIdentity(filePath)));
      if (retryPaths.size === 0) {
        return {};
      }

      return {
        results: state.results.map((result) => {
          if (!retryPaths.has(normalizePathForIdentity(result.fileInfo.filePath))) {
            return result;
          }

          // Re-key to the path the retry is issued with: an organized result carries the output
          // path in fileInfo.filePath while its fileId still derives from the original source path.
          return {
            ...result,
            fileId: buildFileId(result.fileInfo.filePath),
            status: "processing" as const,
            error: undefined,
          };
        }),
      };
    }),
  setFailedCount: (count) => set({ failedCount: Math.max(0, count) }),
  resolveUncensoredResults: (updates) =>
    set((state) => {
      const updateByFileId = new Map(updates.map((item) => [item.fileId, item]));
      return {
        results: state.results.map((result) => {
          const matched = updateByFileId.get(result.fileId);
          if (!matched) {
            return result;
          }

          return {
            ...result,
            fileInfo: {
              ...result.fileInfo,
              filePath: matched.targetVideoPath,
              fileName: getFileNameFromPath(matched.targetVideoPath) || result.fileInfo.fileName,
            },
            nfoPath: matched.targetNfoPath,
            outputPath: deriveGroupingDirectoryFromPath(matched.targetVideoPath),
            uncensoredAmbiguous: false,
          };
        }),
      };
    }),
  reset: () =>
    set({
      isScraping: false,
      scrapeStatus: "idle",
      progress: 0,
      total: 0,
      current: 0,
      failedCount: 0,
      results: [],
    }),
});

export const useScrapeStore = isDev
  ? create<ScrapeState>()(
      persist(storeCreator, {
        name: "scrape-store",
        storage: createJSONStorage(() => (typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage)),
      }),
    )
  : create<ScrapeState>()(storeCreator);
