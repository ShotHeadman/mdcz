import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import { applyMaintenanceSessionSnapshot } from "@mdcz/views/state/maintenanceStore";
import { createRefreshCoordinator } from "@mdcz/views/state/refreshCoordinator";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, subscribeTaskNotifications } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { applyScrapeLiveRunsSnapshot, readScrapeRunsSnapshot } from "../taskHydration";

const FAST_POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const LIVENESS_CHECK_INTERVAL_MS = 2_000;

let requestLiveRunsFromUi: (() => void) | null = null;

/** Used by Web scrape mutations after their acknowledgement; it never applies mutation state. */
export const requestScrapeLiveRunsRefresh = (): void => {
  requestLiveRunsFromUi?.();
};

export const hydrateActiveMaintenanceSession = async (): Promise<void> => {
  applyMaintenanceSessionSnapshot(await api.maintenance.getActiveSession());
};

export const useWebTaskSync = (): void => {
  const queryClient = useQueryClient();
  useEffect(() => {
    let closed = false;
    let connectionOpen = false;
    let lastDispatchAt = Date.now();
    let fastPollingTimer: ReturnType<typeof setInterval> | null = null;
    const refreshErrors: Record<"maintenance" | "scrape", string | null> = {
      maintenance: null,
      scrape: null,
    };
    const updateRefreshError = (source: keyof typeof refreshErrors, error: unknown | null): void => {
      refreshErrors[source] = error === null ? null : error instanceof Error ? error.message : String(error);
      useWorkbenchTaskStore.getState().setRefreshError(
        Object.values(refreshErrors)
          .filter((message): message is string => Boolean(message))
          .join("；") || null,
      );
    };

    const stopFastPolling = (): void => {
      if (!fastPollingTimer) return;
      clearInterval(fastPollingTimer);
      fastPollingTimer = null;
    };

    const coordinator = createRefreshCoordinator<ScrapeLiveRunsResponse>({
      read: readScrapeRunsSnapshot,
      apply: (response) => {
        if (closed) return;
        applyScrapeLiveRunsSnapshot(response.runs);
      },
      onError: (error) => updateRefreshError("scrape", error),
      onSuccess: () => {
        updateRefreshError("scrape", null);
        if (connectionOpen) stopFastPolling();
      },
    });
    const maintenanceCoordinator = createRefreshCoordinator<MaintenanceActiveSessionSnapshot | null>({
      read: async () => await api.maintenance.getActiveSession(),
      apply: (session) => {
        if (closed) return;
        applyMaintenanceSessionSnapshot(session);
      },
      onError: (error) => updateRefreshError("maintenance", error),
      onSuccess: () => updateRefreshError("maintenance", null),
    });
    const refreshLiveRuns = (): void => {
      void coordinator.request();
    };
    const refreshMaintenanceSession = (): void => {
      void maintenanceCoordinator.request();
    };
    const refreshPending = (): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pending.all });
    };
    const startFastPolling = (): void => {
      refreshLiveRuns();
      refreshMaintenanceSession();
      if (fastPollingTimer) return;
      fastPollingTimer = setInterval(() => {
        refreshLiveRuns();
        refreshMaintenanceSession();
      }, FAST_POLL_INTERVAL_MS);
    };
    const recordDispatch = (): void => {
      lastDispatchAt = Date.now();
    };

    requestLiveRunsFromUi = refreshLiveRuns;

    refreshLiveRuns();
    refreshMaintenanceSession();

    const unsubscribe = subscribeTaskNotifications({
      onOpen: () => {
        // The stream's own `ready` invalidation drives the reconnect refresh; reading here would
        // race the server's first event and could resurrect state the stream is about to correct.
        connectionOpen = true;
        recordDispatch();
      },
      onError: () => {
        connectionOpen = false;
        startFastPolling();
      },
      onHeartbeat: () => {
        recordDispatch();
        refreshLiveRuns();
        refreshMaintenanceSession();
      },
      onNotification: (payload) => {
        recordDispatch();
        if (payload.kind === "log") return;
        if (payload.resources.includes("ready")) {
          refreshLiveRuns();
          refreshMaintenanceSession();
          refreshPending();
          return;
        }
        if (payload.resources.includes("scrape-live")) refreshLiveRuns();
        if (payload.resources.includes("maintenance")) refreshMaintenanceSession();
        if (payload.resources.includes("pending")) refreshPending();
      },
    });
    const livenessTimer = setInterval(() => {
      if (Date.now() - lastDispatchAt >= HEARTBEAT_TIMEOUT_MS) startFastPolling();
    }, LIVENESS_CHECK_INTERVAL_MS);

    return () => {
      closed = true;
      coordinator.dispose();
      maintenanceCoordinator.dispose();
      if (requestLiveRunsFromUi === refreshLiveRuns) requestLiveRunsFromUi = null;
      clearInterval(livenessTimer);
      stopFastPolling();
      unsubscribe();
    };
  }, [queryClient]);
};

export const __webTaskSyncTestHooks = {
  FAST_POLL_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  LIVENESS_CHECK_INTERVAL_MS,
};
