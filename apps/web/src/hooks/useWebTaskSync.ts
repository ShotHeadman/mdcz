import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import { applyMaintenanceSessionSnapshot } from "@mdcz/views/state/maintenanceStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useEffect } from "react";
import { api, subscribeTaskNotifications } from "../client";
import { applyPendingUncensoredConfirmation, applyScrapeLiveRunsSnapshot } from "../taskHydration";

const FAST_POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const LIVENESS_CHECK_INTERVAL_MS = 2_000;

export interface RefreshCoordinator {
  dispose(): void;
  request(): Promise<void>;
}

export const createRefreshCoordinator = <T>(input: {
  apply(response: T): void;
  onSuccess?(): void;
  read(): Promise<T>;
}): RefreshCoordinator => {
  let disposed = false;
  let dirty = false;
  let inFlight = false;
  let activeRequest: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    try {
      while (dirty && !disposed) {
        dirty = false;
        try {
          const response = await input.read();
          if (disposed) return;
          input.apply(response);
          input.onSuccess?.();
        } catch {
          // Keep the request dirty, but wait for the next heartbeat, polling
          // tick, invalidation, or mutation acknowledgement to retry.
          dirty = true;
          return;
        }
      }
    } finally {
      inFlight = false;
      activeRequest = null;
    }
  };

  return {
    request: async () => {
      dirty = true;
      if (!inFlight) {
        inFlight = true;
        activeRequest = drain();
      }
      await activeRequest;
    },
    dispose: () => {
      disposed = true;
    },
  };
};

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

const applyActiveMaintenanceSession = (session: MaintenanceActiveSessionSnapshot | null): void => {
  applyMaintenanceSessionSnapshot(session);
  useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(session?.id ?? "");
};

export const hydrateActiveMaintenanceSession = async (): Promise<void> => {
  applyActiveMaintenanceSession(await api.maintenance.getActiveSession());
};

export const useWebTaskSync = (): void => {
  useEffect(() => {
    let closed = false;
    let connectionOpen = false;
    let lastDispatchAt = Date.now();
    let fastPollingTimer: ReturnType<typeof setInterval> | null = null;

    const stopFastPolling = (): void => {
      if (!fastPollingTimer) return;
      clearInterval(fastPollingTimer);
      fastPollingTimer = null;
    };

    const coordinator = createRefreshCoordinator<ScrapeLiveRunsResponse>({
      read: async () => await api.scrape.liveRuns(),
      apply: (response) => {
        if (closed) return;
        const store = useWorkbenchTaskStore.getState();
        store.setHydrationState(applyScrapeLiveRunsSnapshot(response.runs, store.hydrationState));
      },
      onSuccess: () => {
        if (connectionOpen) stopFastPolling();
      },
    });
    const maintenanceCoordinator = createRefreshCoordinator<MaintenanceActiveSessionSnapshot | null>({
      read: async () => await api.maintenance.getActiveSession(),
      apply: (session) => {
        if (closed) return;
        applyActiveMaintenanceSession(session);
      },
    });
    const refreshLiveRuns = (): void => {
      void coordinator.request();
    };
    const refreshMaintenanceSession = (): void => {
      void maintenanceCoordinator.request();
    };
    const refreshPendingUncensored = (): void => {
      void hydratePendingUncensoredConfirmation().catch(() => {});
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
