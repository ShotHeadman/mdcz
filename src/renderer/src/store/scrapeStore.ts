import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ScrapeResult {
  id: string;
  status: "success" | "failed";
  number: string;
  title?: string;
  path: string;
  actors?: string[];
  outline?: string;
  tags?: string[];
  release?: string;
  duration?: string;
  resolution?: string;
  codec?: string;
  bitrate?: string;
  directors?: string[];
  series?: string;
  studio?: string;
  publisher?: string;
  score?: string;
  poster_url?: string;
  thumb_url?: string;
  fanart_url?: string;
  output_path?: string;
  scene_images?: string[];
  /** Maps field names to the website that provided the value. */
  sources?: Record<string, string>;
  error_msg?: string;
}

interface ScrapeState {
  isScraping: boolean;
  scrapeStatus: "idle" | "running" | "stopping" | "paused";
  progress: number;
  total: number;
  current: number;
  failedCount: number;
  results: ScrapeResult[];
  currentFilePath: string;
  statusText: string;

  setScraping: (isScraping: boolean) => void;
  setScrapeStatus: (status: "idle" | "running" | "stopping" | "paused") => void;
  updateProgress: (current: number, total: number) => void;
  addResult: (result: ScrapeResult) => void;
  clearResults: () => void;
  setCurrentFilePath: (path: string) => void;
  setStatusText: (text: string) => void;
  setFailedCount: (count: number) => void;
  reset: () => void;
}

// 开发环境下启用 HMR 状态持久化
const isDev = import.meta.env.DEV;

export const useScrapeStore = create<ScrapeState>()(
  isDev
    ? persist(
        (set) => ({
          isScraping: false,
          scrapeStatus: "idle",
          progress: 0,
          total: 0,
          current: 0,
          failedCount: 0,
          results: [],
          currentFilePath: "",
          statusText: "",

          setScraping: (isScraping) => set({ isScraping }),
          setScrapeStatus: (status) => set({ scrapeStatus: status }),
          updateProgress: (current, total) =>
            set({
              current,
              total,
              progress: total > 0 ? (current / total) * 100 : 0,
            }),
          addResult: (result) => set((state) => ({ results: [...state.results, result] })),
          clearResults: () =>
            set({
              results: [],
              failedCount: 0,
              statusText: "",
              currentFilePath: "",
            }),
          setCurrentFilePath: (path) => set({ currentFilePath: path }),
          setStatusText: (text) => set({ statusText: text }),
          setFailedCount: (count) => set({ failedCount: Math.max(0, count) }),
          reset: () =>
            set({
              isScraping: false,
              scrapeStatus: "idle",
              progress: 0,
              total: 0,
              current: 0,
              failedCount: 0,
              results: [],
              currentFilePath: "",
              statusText: "",
            }),
        }),
        {
          name: "scrape-store",
          storage: createJSONStorage(() => sessionStorage),
        },
      )
    : (set) => ({
        isScraping: false,
        scrapeStatus: "idle",
        progress: 0,
        total: 0,
        current: 0,
        failedCount: 0,
        results: [],
        currentFilePath: "",
        statusText: "",

        setScraping: (isScraping) => set({ isScraping }),
        setScrapeStatus: (status) => set({ scrapeStatus: status }),
        updateProgress: (current, total) =>
          set({
            current,
            total,
            progress: total > 0 ? (current / total) * 100 : 0,
          }),
        addResult: (result) => set((state) => ({ results: [...state.results, result] })),
        clearResults: () =>
          set({
            results: [],
            failedCount: 0,
            statusText: "",
            currentFilePath: "",
          }),
        setCurrentFilePath: (path) => set({ currentFilePath: path }),
        setStatusText: (text) => set({ statusText: text }),
        setFailedCount: (count) => set({ failedCount: Math.max(0, count) }),
        reset: () =>
          set({
            isScraping: false,
            scrapeStatus: "idle",
            progress: 0,
            total: 0,
            current: 0,
            failedCount: 0,
            results: [],
            currentFilePath: "",
            statusText: "",
          }),
      }),
);
