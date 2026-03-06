import "./index.css";
import type { ScrapeResult as BackendScrapeResult } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ipc } from "./client/ipc";
import { BootFallback } from "./components/BootFallback";
import { Toaster } from "./components/ui/Sonner";
import { TooltipProvider } from "./components/ui/Tooltip";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { routeTree } from "./routeTree.gen";
import { createRuntimeLog, useLogStore } from "./store/logStore";
import { type ScrapeResult, useScrapeStore } from "./store/scrapeStore";

const shouldUseHashHistory = typeof window !== "undefined" && window.location.protocol === "file:";

const router = createRouter({
  routeTree,
  ...(shouldUseHashHistory ? { history: createHashHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const formatDuration = (durationSeconds: number | undefined): string | undefined => {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatBitrate = (bitrateBps: number | undefined): string | undefined => {
  if (typeof bitrateBps !== "number" || !Number.isFinite(bitrateBps) || bitrateBps <= 0) {
    return undefined;
  }

  return `${(bitrateBps / 1_000_000).toFixed(1)} Mbps`;
};

const normalizeResultItem = (payload: BackendScrapeResult): ScrapeResult => {
  const data = payload.crawlerData;
  const assets = payload.assets;
  const remotePoster = data?.poster_url ?? data?.cover_url;
  const remoteCover = data?.cover_url ?? data?.poster_url;

  return {
    id: crypto.randomUUID(),
    status: payload.status === "failed" ? "failed" : "success",
    number: payload.fileInfo.number,
    path: payload.fileInfo.filePath,
    title: data?.title_zh ?? data?.title,
    actors: data?.actors,
    outline: data?.plot_zh ?? data?.plot,
    tags: data?.genres,
    release: data?.release_date,
    duration: formatDuration(payload.videoMeta?.durationSeconds ?? data?.durationSeconds),
    resolution:
      payload.videoMeta && payload.videoMeta.width > 0 && payload.videoMeta.height > 0
        ? `${payload.videoMeta.width}x${payload.videoMeta.height}`
        : undefined,
    codec: payload.videoMeta?.codec,
    bitrate: formatBitrate(payload.videoMeta?.bitrate),
    directors: data?.director ? [data.director] : undefined,
    series: data?.series,
    studio: data?.studio,
    publisher: data?.publisher,
    score: typeof data?.rating === "number" ? String(data.rating) : undefined,
    poster_url: assets?.poster ?? remotePoster,
    thumb_url: assets?.cover ?? remoteCover,
    output_path: payload.outputPath,
    scene_images: assets?.sceneImages,
    sources: payload.sources as Record<string, string> | undefined,
    error_msg: payload.error,
  };
};

const App = () => {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [stylesReady, setStylesReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let interval: number | undefined;
    const logStore = useLogStore.getState();
    const scrapeStore = useScrapeStore.getState();
    const unsubscribers: Array<() => void> = [];

    const bootstrap = async () => {
      if (!window.api) {
        setRuntimeError("IPC bridge is unavailable. Please restart MDCz.");
        setRuntimeReady(true);
        return;
      }

      const applyStatusSnapshot = (status: Awaited<ReturnType<typeof ipc.scraper.getStatus>>) => {
        const activeState = status.state ?? (status.running ? "running" : "idle");
        const active = activeState !== "idle";
        const pending = Math.max(status.totalFiles - status.completedFiles, 0);
        const shouldSyncProgressFromStatus = activeState === "idle" || activeState === "paused";

        scrapeStore.setScraping(active);
        scrapeStore.setScrapeStatus(activeState);
        if (shouldSyncProgressFromStatus) {
          scrapeStore.updateProgress(status.completedFiles, status.totalFiles);
        }
        scrapeStore.setFailedCount(status.failedCount);
        scrapeStore.setStatusText(
          `${activeState === "paused" ? "已暂停 | " : activeState === "stopping" ? "正在停止 | " : ""}待处理: ${pending} | 成功: ${status.successCount} | 失败: ${status.failedCount} | 跳过: ${status.skippedCount}`,
        );
      };

      const syncStatusNow = async () => {
        const status = await ipc.scraper.getStatus();
        applyStatusSnapshot(status);
      };

      try {
        unsubscribers.push(
          ipc.on.log((payload) => {
            logStore.addLog(createRuntimeLog(payload.level ?? "info", payload.text));
          }),
        );

        unsubscribers.push(
          ipc.on.scrapeInfo((payload) => {
            scrapeStore.setCurrentFilePath(payload.fileInfo.filePath);
          }),
        );

        unsubscribers.push(
          ipc.on.scrapeResult((payload) => {
            if (payload.status === "processing" || payload.status === "pending" || payload.status === "skipped") {
              return;
            }
            scrapeStore.addResult(normalizeResultItem(payload));
            void syncStatusNow();
          }),
        );

        unsubscribers.push(
          ipc.on.failedInfo(() => {
            void syncStatusNow();
          }),
        );

        unsubscribers.push(
          ipc.on.progress((payload) => {
            scrapeStore.updateProgress(payload.value, 100);
          }),
        );

        unsubscribers.push(
          ipc.on.buttonStatus((payload) => {
            const isRunning = !payload.startEnabled && payload.stopEnabled;
            const isStopping = !payload.startEnabled && !payload.stopEnabled;
            const active = isRunning || isStopping;

            scrapeStore.setScraping(active);
            scrapeStore.setScrapeStatus(isRunning ? "running" : isStopping ? "stopping" : "idle");
            void syncStatusNow();
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeError(`Failed to initialize IPC subscriptions: ${message}`);
        setRuntimeReady(true);
        return;
      }

      const poll = async () => {
        try {
          await syncStatusNow();
        } catch (error) {
          void error;
        }
      };

      await poll();
      interval = window.setInterval(() => {
        void poll();
      }, 1200);

      if (!disposed) {
        setRuntimeReady(true);
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = performance.now();

    const checkStyles = () => {
      if (cancelled) {
        return;
      }
      const now = performance.now();
      const computed = getComputedStyle(document.documentElement);
      const hasStyles = computed.getPropertyValue("--card").trim().length > 0;
      if (hasStyles || now - start >= 2500) {
        setStylesReady(true);
        return;
      }
      requestAnimationFrame(checkStyles);
    };

    checkStyles();
    return () => {
      cancelled = true;
    };
  }, []);

  if (runtimeError) {
    return <BootFallback message={runtimeError} />;
  }

  if (!runtimeReady || !stylesReady) {
    return <BootFallback message={stylesReady ? "Starting app..." : "Loading styles..."} />;
  }

  return (
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Suspense fallback={<BootFallback message="Loading page..." />}>
              <RouterProvider router={router} />
            </Suspense>
            <Toaster />
          </ToastProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
};

export default App;
