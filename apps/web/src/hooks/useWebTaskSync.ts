import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import { applyMaintenanceSessionSnapshot } from "@mdcz/views/state/maintenanceStore";
import { createRefreshCoordinator } from "@mdcz/views/state/refreshCoordinator";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useEffect } from "react";
import { api, subscribeTaskNotifications } from "../client";
import { applyPendingUncensoredConfirmation, applyScrapeLiveRunsSnapshot } from "../taskHydration";

const FAST_POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const LIVENESS_CHECK_INTERVAL_MS = 2_000;

let requestLiveRunsFromUi: (() => void) | null = null;
let requestPendingUncensoredFromUi: (() => void) | null = null;

/** Used by Web scrape mutations after their acknowledgement; it never applies mutation state. */
export const requestScrapeLiveRunsRefresh = (): void => {
  requestLiveRunsFromUi?.();
};

export const requestPendingUncensoredConfirmationRefresh = (): void => {
  requestPendingUncensoredFromUi?.();
};

export const hydratePendingUncensoredConfirmation = async (): Promise<void> => {
  const response = await api.scrape.pendingUncensoredConfirmation();
  const store = useWorkbenchTaskStore.getState();
  store.setHydrationState(applyPendingUncensoredConfirmation(response, store.hydrationState));
};

export const hydrateActiveMaintenanceSession = async (): Promise<void> => {
  applyMaintenanceSessionSnapshot(await api.maintenance.getActiveSession());
};

export const useWebTaskSync = (): void => {
  useEffect(() => {
    let closed = false;
    let connectionOpen = false;
    let lastDispatchAt = Date.now();
    let fastPollingTimer: ReturnType<typeof setInterval> | null = null;
    const refreshErrors: Record<"maintenance" | "pending" | "scrape", string | null> = {
      maintenance: null,
      pending: null,
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
      read: async () => await api.scrape.liveRuns(),
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
    const refreshPendingUncensored = (): void => {
      void hydratePendingUncensoredConfirmation().then(
        () => updateRefreshError("pending", null),
        (error) => updateRefreshError("pending", error),
      );
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
    requestPendingUncensoredFromUi = refreshPendingUncensored;

    refreshLiveRuns();
    refreshPendingUncensored();
    refreshMaintenanceSession();

    const unsubscribe = subscribeTaskNotifications({
      onOpen: () => {
        connectionOpen = true;
        recordDispatch();
        refreshLiveRuns();
        refreshMaintenanceSession();
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
        if (payload.resources.includes("scrape-live")) refreshLiveRuns();
        if (payload.resources.includes("maintenance")) refreshMaintenanceSession();
        if (payload.resources.includes("pending-confirmation")) refreshPendingUncensored();
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
      if (requestPendingUncensoredFromUi === refreshPendingUncensored) requestPendingUncensoredFromUi = null;
      clearInterval(livenessTimer);
      stopFastPolling();
      unsubscribe();
    };
  }, []);
};

export const __webTaskSyncTestHooks = {
  FAST_POLL_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  LIVENESS_CHECK_INTERVAL_MS,
};
