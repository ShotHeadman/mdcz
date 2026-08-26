import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { ScraperStatus } from "@mdcz/shared/types";
import { createRuntimeLog, useLogStore } from "@mdcz/views/state/logStore";
import { applyMaintenanceSessionSnapshot, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { overviewKeys } from "@/api/overview";
import { ipc } from "@/client/ipc";

type SyncTarget = "all" | "scrape" | "maintenance";

const getPollingInterval = (
  scrapeState: ScraperStatus["state"],
  maintenanceState: ReturnType<typeof useMaintenanceStore.getState>["executionStatus"],
): number => {
  if (scrapeState === "running" || maintenanceState === "executing") {
    return 800;
  }

  if (
    scrapeState === "paused" ||
    scrapeState === "stopping" ||
    maintenanceState === "scanning" ||
    maintenanceState === "previewing" ||
    maintenanceState === "paused" ||
    maintenanceState === "stopping"
  ) {
    return 2000;
  }

  return 10000;
};

const getSyncTarget = (): SyncTarget => {
  const scrapeState = useScrapeStore.getState().scrapeStatus;
  const maintenanceState = useMaintenanceStore.getState().executionStatus;
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

export const applyScrapeStatusSnapshot = (status: ScraperStatus) => {
  const scrapeStore = useScrapeStore.getState();
  const previousState = scrapeStore.scrapeStatus;
  const activeState = status.state ?? (status.running ? "running" : "idle");
  const active = activeState !== "idle";

  if (activeState === "idle" && previousState !== "idle") {
    scrapeStore.failUnfinishedResults("已停止或未完成");
  }
  scrapeStore.setScraping(active);
  scrapeStore.setScrapeStatus(activeState);
  scrapeStore.updateProgress(status.completedFiles, status.totalFiles, status.percent);
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

export const applyMaintenanceRuntimeSnapshot = (session: MaintenanceActiveSessionSnapshot | null): void => {
  const execution = useMaintenanceStore.getState();
  const hasBackendOwnedRendererState =
    Boolean(execution.activeBatchId) ||
    Object.values(useMaintenanceStore.getState().previewResults).some(
      (preview) => Boolean(preview.previewId) || Boolean(preview.taskId),
    ) ||
    execution.executionStatus === "previewing" ||
    execution.executionStatus === "executing" ||
    execution.executionStatus === "paused" ||
    execution.executionStatus === "stopping";
  if (session || hasBackendOwnedRendererState) {
    applyMaintenanceSessionSnapshot(session);
  }
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
      const maintenanceState = useMaintenanceStore.getState().executionStatus;

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
          applyMaintenanceRuntimeSnapshot(await ipc.maintenance.getActiveSession());
          return;
        }

        const [scrapeStatus, maintenanceSession] = await Promise.all([
          ipc.scraper.getStatus(),
          ipc.maintenance.getActiveSession(),
        ]);
        applyScrapeStatusSnapshot(scrapeStatus);
        applyMaintenanceRuntimeSnapshot(maintenanceSession);
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
          ipc.on.scrapeResult((payload) => {
            useScrapeStore.getState().upsertResult(payload);
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
            const maintenanceState = useMaintenanceStore.getState();
            if (
              maintenanceState.executionStatus === "previewing" ||
              maintenanceState.executionStatus === "executing" ||
              maintenanceState.executionStatus === "paused" ||
              maintenanceState.executionStatus === "stopping"
            ) {
              maintenanceState.setProgress(payload.value, payload.current, payload.total);
              return;
            }

            useScrapeStore.getState().setProgressPercent(payload.value);
          }),
        );

        unsubscribers.push(
          ipc.on.buttonStatus((payload) => {
            const scrapeStore = useScrapeStore.getState();
            const previousStatus = scrapeStore.scrapeStatus;
            const isRunning = !payload.startEnabled && payload.stopEnabled;
            const isStopping = !payload.startEnabled && !payload.stopEnabled;
            const active = isRunning || isStopping;
            const nextStatus = isRunning ? "running" : isStopping ? "stopping" : "idle";

            if (nextStatus === "idle" && previousStatus !== "idle") {
              scrapeStore.failUnfinishedResults("已停止或未完成");
            }
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
