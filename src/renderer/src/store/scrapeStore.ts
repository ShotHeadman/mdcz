import type { ScrapeResult as SharedScrapeResult, UncensoredConfirmResultItem } from "@shared/types";
import type { StateCreator } from "zustand";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deriveGroupingDirectoryFromPath } from "@/lib/multipartDisplay";

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
  updateProgress: (current: number, total: number) => void;
  addResult: (result: ScrapeResult) => void;
  clearResults: () => void;
  setFailedCount: (count: number) => void;
  resolveUncensoredResults: (updates: UncensoredConfirmResultItem[]) => void;
  reset: () => void;
}

// 开发环境下启用 HMR 状态持久化
const isDev = import.meta.env.DEV;
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const getFileNameFromPath = (filePath: string): string => {
  const slashIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath;
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
  updateProgress: (current, total) =>
    set({
      current,
      total,
      progress: total > 0 ? (current / total) * 100 : 0,
    }),
  addResult: (result) =>
    set((state) => ({
      results: [...state.results, result],
    })),
  clearResults: () =>
    set({
      results: [],
      failedCount: 0,
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
