import { toErrorMessage } from "@mdcz/shared/error";
import { createRuntimeLog, useLogStore } from "@mdcz/views/state/logStore";
import { applyMaintenanceSessionSnapshot, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { createRefreshCoordinator } from "@mdcz/views/state/refreshCoordinator";
import { selectScrapeTaskId, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { overviewKeys } from "@/api/overview";
import { ipc } from "@/client/ipc";

export const useIpcSync = (queryClient: QueryClient) => {
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.api) {
      setRuntimeError("IPC bridge is unavailable. Please restart MDCz.");
      setRuntimeReady(true);
      return;
    }

    let disposed = false;
    const reportError = (resource: "scrape" | "maintenance", error: unknown) => {
      const message = toErrorMessage(error);
      if (resource === "scrape") useScrapeStore.getState().setError(message);
      else useMaintenanceStore.getState().setError(message);
      useLogStore.getState().addLog(createRuntimeLog("error", `Failed to refresh ${resource}: ${message}`));
    };
    const scrape = createRefreshCoordinator({
      read: () => ipc.scraper.getStatus(selectScrapeTaskId(useScrapeStore.getState()) || undefined),
      apply: (snapshot) => {
        if (snapshot) useScrapeStore.getState().setSnapshot(snapshot);
      },
      onError: (error) => reportError("scrape", error),
    });
    const maintenance = createRefreshCoordinator({
      read: ipc.maintenance.getActiveSession,
      apply: applyMaintenanceSessionSnapshot,
      onError: (error) => reportError("maintenance", error),
    });
    const refreshAll = async () => await Promise.all([scrape.request(), maintenance.request()]);

    const unsubscribers = [
      ipc.on.log((payload) => {
        useLogStore.getState().addLog(createRuntimeLog(payload.level ?? "info", payload.text, payload.timestamp));
      }),
      ipc.on.invalidate((payload) => {
        if (payload.resources.includes("scrape")) void scrape.request();
        if (payload.resources.includes("maintenance")) void maintenance.request();
        if (payload.resources.includes("overview")) {
          void queryClient.invalidateQueries({ queryKey: overviewKeys.all });
        }
      }),
    ];

    void refreshAll().then(() => {
      if (!disposed) setRuntimeReady(true);
    });

    return () => {
      disposed = true;
      scrape.dispose();
      maintenance.dispose();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [queryClient]);

  return { runtimeReady, runtimeError };
};
