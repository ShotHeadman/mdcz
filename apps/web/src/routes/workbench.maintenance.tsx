import type { MaintenancePresetIdDto } from "@mdcz/shared";
import { type MaintenanceApplyRequest, MaintenanceView } from "@mdcz/views/maintenance";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, subscribeTaskUpdates } from "../client";
import { AppLink, formatDate, scanStatusLabels } from "./Common";

export function MaintenancePage() {
  const queryClient = useQueryClient();
  const [rootId, setRootId] = useState("");
  const [presetId, setPresetId] = useState<MaintenancePresetIdDto>("read_local");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const rootsQ = useQuery({ queryFn: () => api.mediaRoots.list(), queryKey: ["mediaRoots"], retry: false });
  const tasksQ = useQuery({ queryFn: () => api.maintenance.recover(), queryKey: ["maintenanceTasks"], retry: false });
  const previewQ = useQuery({
    enabled: Boolean(activeTaskId),
    queryFn: () => api.maintenance.preview({ taskId: activeTaskId ?? "" }),
    queryKey: ["maintenancePreview", activeTaskId],
    retry: false,
  });

  const startM = useMutation({
    mutationFn: () => api.maintenance.start({ rootId, presetId }),
    onSuccess: async (task) => {
      setActiveTaskId(task.id);
      await queryClient.invalidateQueries({ queryKey: ["maintenanceTasks"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const applyM = useMutation({
    mutationFn: (input: MaintenanceApplyRequest) =>
      api.maintenance.apply({
        taskId: activeTaskId ?? "",
        confirmationToken: previewQ.data?.confirmationToken,
        previewIds: input.previewIds,
        selections: input.selections,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["maintenancePreview", activeTaskId] });
      await queryClient.invalidateQueries({ queryKey: ["maintenanceTasks"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
  });
  const controlM = useMutation({
    mutationFn: ({ action, taskId }: { action: "pause" | "resume" | "stop" | "retry"; taskId: string }) => {
      if (action === "retry") {
        return api.maintenance.start({ rootId: previewQ.data?.task.rootId ?? rootId, presetId });
      }
      return api.maintenance[action]({ taskId });
    },
    onSuccess: async (task) => {
      setActiveTaskId(task.id);
      await queryClient.invalidateQueries({ queryKey: ["maintenanceTasks"] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const enabledRoots = useMemo(() => rootsQ.data?.roots.filter((root) => root.enabled) ?? [], [rootsQ.data?.roots]);
  const tasks = tasksQ.data?.tasks ?? [];
  const previewItems = previewQ.data?.items ?? [];

  useEffect(() => {
    if (!rootId && enabledRoots[0]) {
      setRootId(enabledRoots[0].id);
    }
  }, [enabledRoots, rootId]);

  useEffect(() => {
    if (!activeTaskId && tasks[0]) {
      setActiveTaskId(tasks[0].id);
    }
  }, [activeTaskId, tasks]);

  useEffect(
    () =>
      subscribeTaskUpdates((payload) => {
        if (payload.kind === "task" && payload.task.kind !== "maintenance") return;
        void queryClient.invalidateQueries({ queryKey: ["maintenanceTasks"] });
        void queryClient.invalidateQueries({ queryKey: ["maintenancePreview"] });
      }),
    [queryClient],
  );

  return (
    <MaintenanceView
      activeTaskId={activeTaskId}
      applyDisabled={previewItems.length === 0}
      enabledRoots={enabledRoots}
      errorMessage={startM.error?.message ?? applyM.error?.message ?? controlM.error?.message}
      isApplying={applyM.isPending}
      isStarting={startM.isPending}
      labels={{ formatDate, scanStatus: scanStatusLabels }}
      mediaRootsLink={
        <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/media-roots">
          媒体目录
        </AppLink>
      }
      onApply={(input) => void applyM.mutate(input)}
      onPresetChange={setPresetId}
      onRefresh={() => {
        void tasksQ.refetch();
        void previewQ.refetch();
      }}
      onRootChange={setRootId}
      onStart={() => void startM.mutate()}
      onTaskControl={(action: "pause" | "resume" | "stop" | "retry", taskId: string) =>
        void controlM.mutate({ action, taskId })
      }
      onTaskSelect={setActiveTaskId}
      presetId={presetId}
      previewItems={previewItems}
      rootId={rootId}
      tasks={tasks}
    />
  );
}

export const Route = createFileRoute("/workbench/maintenance")({
  component: MaintenancePage,
});
