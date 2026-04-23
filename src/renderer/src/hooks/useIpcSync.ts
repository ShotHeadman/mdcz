import { toErrorMessage } from "@shared/error";
import type { MaintenanceStatus, ScraperStatus } from "@shared/types";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { overviewKeys } from "@/api/overview";
import { ipc } from "@/client/ipc";
import { createRuntimeLog, useLogStore } from "@/store/logStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { applyMaintenanceExecutionItemResult, applyMaintenanceStatusSnapshot } from "@/store/maintenanceSession";
import { useScrapeStore } from "@/store/scrapeStore";

type SyncTarget = "all" | "scrape" | "maintenance";

const getPollingInterval = (
  scrapeState: ScraperStatus["state"],
  maintenanceState: MaintenanceStatus["state"],
): number => {
  if (scrapeState === "running" || maintenanceState === "executing") {
    return 800;
  }

  if (
    scrapeState === "paused" ||
    scrapeState === "stopping" ||
    maintenanceState === "scanning" ||
    maintenanceState === "previewing" ||
    maintenanceState === "stopping"
  ) {
    return 2000;
  }

  return 10000;
};

const getSyncTarget = (): SyncTarget => {
  const scrapeState = useScrapeStore.getState().scrapeStatus;
  const maintenanceState = useMaintenanceExecutionStore.getState().executionStatus;
  const scrapeBusy = scrapeState !== "idle";
  const maintenanceBusy = maintenanceState !== "idle";

  if (scrapeBusy && !maintenanceBusy) {
    return "scrape";
  }

  if (maintenanceBusy && !scrapeBusy) {
    return "maintenance";
  }

  return "all";
};

const applyScrapeStatusSnapshot = (status: ScraperStatus) => {
  const scrapeStore = useScrapeStore.getState();
  const activeState = status.state ?? (status.running ? "running" : "idle");
  const active = activeState !== "idle";
  const shouldSyncProgressFromStatus = activeState === "idle" || activeState === "paused";

  scrapeStore.setScraping(active);
  scrapeStore.setScrapeStatus(activeState);

  if (shouldSyncProgressFromStatus) {
    scrapeStore.updateProgress(status.completedFiles, status.totalFiles);
  }

  scrapeStore.setFailedCount(status.failedCount);
};

export const createOverviewInvalidationTracker = () => {
  let lastButtonStatusActive = false;

  return (nextActive: boolean): boolean => {
    const shouldInvalidate = lastButtonStatusActive && !nextActive;
    lastButtonStatusActive = nextActive;
    return shouldInvalidate;
  };
};

export const useIpcSync = (queryClient: QueryClient) => {
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pollTimeout: number | undefined;
    let syncPromise: Promise<void> | null = null;
    const shouldInvalidateOverview = createOverviewInvalidationTracker();
    const unsubscribers: Array<() => void> = [];

    const reportAsyncError = (context: string, error: unknown) => {
      const message = toErrorMessage(error);
      useLogStore.getState().addLog(createRuntimeLog("error", `${context}: ${message}`, Date.now()));
      console.error(`[useIpcSync] ${context}`, error);
    };

    const clearPollTimeout = () => {
      if (pollTimeout !== undefined) {
        window.clearTimeout(pollTimeout);
        pollTimeout = undefined;
      }
    };

    const scheduleNextPoll = () => {
      if (disposed) {
        return;
      }

      clearPollTimeout();
      const scrapeState = useScrapeStore.getState().scrapeStatus;
      const maintenanceState = useMaintenanceExecutionStore.getState().executionStatus;

      pollTimeout = window.setTimeout(
        () => {
          void syncStatusNow(getSyncTarget(), "poll");
        },
        getPollingInterval(scrapeState, maintenanceState),
      );
    };

    const syncStatusNow = async (target: SyncTarget, context: string) => {
      if (syncPromise) {
        return await syncPromise;
      }

      syncPromise = (async () => {
        if (target === "scrape") {
          applyScrapeStatusSnapshot(await ipc.scraper.getStatus());
          return;
        }

        if (target === "maintenance") {
          applyMaintenanceStatusSnapshot(await ipc.maintenance.getStatus());
          return;
        }

        const [scrapeStatus, maintenanceStatus] = await Promise.all([
          ipc.scraper.getStatus(),
          ipc.maintenance.getStatus(),
        ]);
        applyScrapeStatusSnapshot(scrapeStatus);
        applyMaintenanceStatusSnapshot(maintenanceStatus);
      })()
        .catch((error) => {
          reportAsyncError(`Failed to sync runtime status during ${context}`, error);
          throw error;
        })
        .finally(() => {
          syncPromise = null;
          scheduleNextPoll();
        });

      return await syncPromise;
    };

    const safeSync = (context: string, target = getSyncTarget()) => {
      void syncStatusNow(target, context).catch(() => {});
    };

    const bootstrap = async () => {
      if (!window.api) {
        setRuntimeError("IPC bridge is unavailable. Please restart MDCz.");
        setRuntimeReady(true);
        return;
      }

      try {
        unsubscribers.push(
          ipc.on.log((payload) => {
            useLogStore.getState().addLog(createRuntimeLog(payload.level ?? "info", payload.text, payload.timestamp));
          }),
        );

        unsubscribers.push(
          ipc.on.maintenanceItemResult((payload) => {
            applyMaintenanceExecutionItemResult(payload);
            safeSync("maintenance item result", "maintenance");
          }),
        );

        unsubscribers.push(
          ipc.on.scrapeResult((payload) => {
            if (payload.status === "processing" || payload.status === "pending" || payload.status === "skipped") {
              return;
            }

            useScrapeStore.getState().addResult(payload);
            safeSync("scrape result", "scrape");
          }),
        );

        unsubscribers.push(
          ipc.on.failedInfo(() => {
            safeSync("failed info", "scrape");
          }),
        );

        unsubscribers.push(
          ipc.on.progress((payload) => {
            const maintenanceState = useMaintenanceExecutionStore.getState();
            if (maintenanceState.executionStatus === "executing" || maintenanceState.executionStatus === "stopping") {
              maintenanceState.setProgress(payload.value, payload.current, payload.total);
              return;
            }

            useScrapeStore.getState().updateProgress(payload.value, 100);
          }),
        );

        unsubscribers.push(
          ipc.on.buttonStatus((payload) => {
            const scrapeStore = useScrapeStore.getState();
            const isRunning = !payload.startEnabled && payload.stopEnabled;
            const isStopping = !payload.startEnabled && !payload.stopEnabled;
            const active = isRunning || isStopping;
            const nextStatus = isRunning ? "running" : isStopping ? "stopping" : "idle";

            scrapeStore.setScraping(active);
            scrapeStore.setScrapeStatus(nextStatus);
            if (shouldInvalidateOverview(active)) {
              void queryClient.invalidateQueries({ queryKey: overviewKeys.all });
            }
            safeSync("button status", "scrape");
          }),
        );
      } catch (error) {
        const message = toErrorMessage(error);
        setRuntimeError(`Failed to initialize IPC subscriptions: ${message}`);
        setRuntimeReady(true);
        return;
      }

      try {
        await syncStatusNow("all", "bootstrap");
      } catch (error) {
        const message = toErrorMessage(error);
        setRuntimeError(`Failed to initialize runtime state: ${message}`);
        setRuntimeReady(true);
        return;
      }

      if (!disposed) {
        setRuntimeReady(true);
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      clearPollTimeout();

      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [queryClient]);

  return {
    runtimeReady,
    runtimeError,
  };
};
