import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import { applyMaintenanceClientSession } from "@mdcz/views/state/maintenanceSession";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useEffect } from "react";
import { api, subscribeTaskRealtime } from "../client";
import {
  applyPendingUncensoredConfirmation,
  applyScrapeLiveRunsSnapshot,
  applyTaskRealtimeEvent,
  applyWebTaskUpdate,
} from "../taskHydration";

const FAST_POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const LIVENESS_CHECK_INTERVAL_MS = 2_000;

export interface ScrapeLiveRunsRefreshCoordinator {
  dispose(): void;
  request(): Promise<void>;
}

/**
 * Serializes all authority reads.  A new signal received while a request is in
 * flight simply marks the coordinator dirty, so its response can be applied
 * first and one fresh response immediately follows it.
 */
export const createScrapeLiveRunsRefreshCoordinator = (input: {
  apply(response: ScrapeLiveRunsResponse): void;
  onSuccess?(): void;
  read(): Promise<ScrapeLiveRunsResponse>;
}): ScrapeLiveRunsRefreshCoordinator => {
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

export const applyWebTaskSnapshot = async (): Promise<void> => {
  const response = await api.tasks.list();
  const nextState = applyWebTaskUpdate(
    {
      kind: "snapshot",
      tasks: response.tasks,
    },
    useWorkbenchTaskStore.getState().hydrationState,
  );
  useWorkbenchTaskStore.getState().setHydrationState(nextState);
};

export const hydratePendingUncensoredConfirmation = async (): Promise<void> => {
  const response = await api.scrape.pendingUncensoredConfirmation();
  const store = useWorkbenchTaskStore.getState();
  store.setHydrationState(applyPendingUncensoredConfirmation(response, store.hydrationState));
};

export const hydrateActiveMaintenanceSession = async (): Promise<void> => {
  const session = await api.maintenance.getActiveSession();
  applyMaintenanceClientSession(session);
  useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(session?.taskId ?? "");
};

export const useWebTaskSync = (): void => {
  const setHydrationState = useWorkbenchTaskStore((state) => state.setHydrationState);

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

    const coordinator = createScrapeLiveRunsRefreshCoordinator({
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
    const refreshLiveRuns = (): void => {
      void coordinator.request();
    };
    const refreshPendingUncensored = (): void => {
      void hydratePendingUncensoredConfirmation().catch(() => {});
    };
    const startFastPolling = (): void => {
      if (fastPollingTimer) return;
      refreshLiveRuns();
      fastPollingTimer = setInterval(refreshLiveRuns, FAST_POLL_INTERVAL_MS);
    };
    const recordDispatch = (): void => {
      lastDispatchAt = Date.now();
    };

    requestLiveRunsFromUi = refreshLiveRuns;
    requestPendingUncensoredFromUi = refreshPendingUncensored;

    // These are deliberately independent first reads: generic task history,
    // live scrape state, and durable uncensored confirmation do not gate one
    // another on a page mount.
    void applyWebTaskSnapshot().catch(() => {});
    refreshLiveRuns();
    refreshPendingUncensored();
    void hydrateActiveMaintenanceSession().catch(() => {});

    const unsubscribe = subscribeTaskRealtime({
      onOpen: () => {
        connectionOpen = true;
        recordDispatch();
        refreshLiveRuns();
      },
      onError: () => {
        connectionOpen = false;
        startFastPolling();
      },
      onHeartbeat: () => {
        recordDispatch();
        refreshLiveRuns();
      },
      onEvent: (payload) => {
        recordDispatch();
        const nextState = applyTaskRealtimeEvent(payload, useWorkbenchTaskStore.getState().hydrationState);
        setHydrationState(nextState);
      },
      onUpdate: (payload) => {
        recordDispatch();
        const nextState = applyWebTaskUpdate(payload, useWorkbenchTaskStore.getState().hydrationState);
        setHydrationState(nextState);

        if (payload.kind === "scrape-invalidated") {
          refreshLiveRuns();
          refreshPendingUncensored();
        }
        if (payload.kind === "event" && (payload.event.type === "completed" || payload.event.type === "failed")) {
          refreshPendingUncensored();
        }
      },
    });
    const livenessTimer = setInterval(() => {
      if (Date.now() - lastDispatchAt >= HEARTBEAT_TIMEOUT_MS) startFastPolling();
    }, LIVENESS_CHECK_INTERVAL_MS);

    return () => {
      closed = true;
      coordinator.dispose();
      if (requestLiveRunsFromUi === refreshLiveRuns) requestLiveRunsFromUi = null;
      if (requestPendingUncensoredFromUi === refreshPendingUncensored) requestPendingUncensoredFromUi = null;
      clearInterval(livenessTimer);
      stopFastPolling();
      unsubscribe();
    };
  }, [setHydrationState]);
};

export const __webTaskSyncTestHooks = {
  FAST_POLL_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  LIVENESS_CHECK_INTERVAL_MS,
};
