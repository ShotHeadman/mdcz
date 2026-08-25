import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import type { MaintenanceClientSession } from "@mdcz/shared/types";
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

export interface MaintenanceSessionRefreshCoordinator {
  dispose(): void;
  notifyLiveUpdate(): void;
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

/**
 * Serializes authoritative maintenance-session reads. A live maintenance
 * event invalidates an in-flight response, so an older full response cannot
 * replace the state that event just advanced.
 */
export const createMaintenanceSessionRefreshCoordinator = (input: {
  apply(session: MaintenanceClientSession | null): void;
  read(): Promise<MaintenanceClientSession | null>;
}): MaintenanceSessionRefreshCoordinator => {
  let disposed = false;
  let dirty = false;
  let inFlight = false;
  let liveUpdateVersion = 0;
  let activeRequest: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    try {
      while (dirty && !disposed) {
        dirty = false;
        const requestLiveUpdateVersion = liveUpdateVersion;
        try {
          const session = await input.read();
          if (disposed) return;
          if (liveUpdateVersion !== requestLiveUpdateVersion) {
            dirty = true;
            continue;
          }
          input.apply(session);
        } catch {
          // Keep the request dirty, but wait for the next heartbeat, polling
          // tick, or reconnect to retry.
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
    notifyLiveUpdate: () => {
      liveUpdateVersion += 1;
      if (inFlight) dirty = true;
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

const applyActiveMaintenanceSession = (session: MaintenanceClientSession | null): void => {
  applyMaintenanceClientSession(session);
  useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId(session?.taskId ?? "");
};

export const hydrateActiveMaintenanceSession = async (): Promise<void> => {
  applyActiveMaintenanceSession(await api.maintenance.getActiveSession());
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
    const maintenanceCoordinator = createMaintenanceSessionRefreshCoordinator({
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

    // These are deliberately independent first reads: generic task history,
    // live scrape state, and durable uncensored confirmation do not gate one
    // another on a page mount.
    void applyWebTaskSnapshot().catch(() => {});
    refreshLiveRuns();
    refreshPendingUncensored();
    refreshMaintenanceSession();

    const unsubscribe = subscribeTaskRealtime({
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
      onEvent: (payload) => {
        recordDispatch();
        if (
          payload.kind === "maintenance-preview-item" ||
          payload.kind === "maintenance-apply-item" ||
          (payload.kind === "task-progress" && payload.taskKind === "maintenance") ||
          payload.kind === "task-failed"
        ) {
          maintenanceCoordinator.notifyLiveUpdate();
        }
        const nextState = applyTaskRealtimeEvent(payload, useWorkbenchTaskStore.getState().hydrationState);
        setHydrationState(nextState);
      },
      onUpdate: (payload) => {
        recordDispatch();
        if (
          (payload.kind === "task" && payload.task.kind === "maintenance") ||
          (payload.kind === "snapshot" && payload.tasks.some((task) => task.kind === "maintenance"))
        ) {
          maintenanceCoordinator.notifyLiveUpdate();
          refreshMaintenanceSession();
        }
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
      maintenanceCoordinator.dispose();
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
