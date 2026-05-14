import { useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import { useEffect } from "react";
import { api, subscribeTaskRealtime } from "../client";
import { applyTaskRealtimeEvent, applyWebTaskUpdate, hydrateWorkbenchScrapeResults } from "../taskHydration";

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

export const hydrateActiveScrapeTaskResults = async (taskId: string): Promise<void> => {
  const response = await api.scrape.listResults({ taskId });
  const previous = useWorkbenchTaskStore.getState().hydrationState;
  useWorkbenchTaskStore
    .getState()
    .setHydrationState(hydrateWorkbenchScrapeResults(response, { ...previous, activeScrapeTaskId: taskId }));
};

export const useWebTaskSync = (): void => {
  const activeScrapeTaskId = useWorkbenchTaskStore((state) => state.hydrationState.activeScrapeTaskId);
  const setHydrationState = useWorkbenchTaskStore((state) => state.setHydrationState);

  useEffect(() => {
    void applyWebTaskSnapshot().catch(() => {});

    const unsubscribe = subscribeTaskRealtime({
      onEvent: (payload) => {
        const nextState = applyTaskRealtimeEvent(payload, useWorkbenchTaskStore.getState().hydrationState);
        setHydrationState(nextState);
      },
      onUpdate: (payload) => {
        const nextState = applyWebTaskUpdate(payload, useWorkbenchTaskStore.getState().hydrationState);
        setHydrationState(nextState);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [setHydrationState]);

  useEffect(() => {
    const taskId = activeScrapeTaskId.trim();
    if (!taskId) return;

    void hydrateActiveScrapeTaskResults(taskId).catch(() => {});
  }, [activeScrapeTaskId]);
};
