import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { PendingView } from "@mdcz/views/pending";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../client";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";

export function PendingPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQ = useQuery({ queryKey: queryKeys.pending.all, queryFn: () => api.pending.list() });
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list() });
  const items = listQ.data?.items ?? [];
  const activeId = selectedId && items.some((item) => item.id === selectedId) ? selectedId : (items[0]?.id ?? null);
  const detailQ = useQuery({
    queryKey: queryKeys.pending.detail(activeId ?? ""),
    queryFn: () => api.pending.detail({ id: activeId ?? "" }),
    enabled: Boolean(activeId),
  });
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.pending.all });
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(toErrorMessage(error), { id: "pending" });
    }
  };

  return (
    <PendingView
      items={items}
      loading={listQ.isLoading}
      errorMessage={listQ.error ? toErrorMessage(listQ.error) : null}
      selectedId={activeId}
      onSelect={setSelectedId}
      detail={activeId ? detailQ.data : null}
      detailLoading={detailQ.isLoading}
      libraries={librariesQ.data?.libraries ?? []}
      onRetry={async (input) =>
        await act(async () => {
          await api.pending.retry(input);
          requestScrapeLiveRunsRefresh();
          // The scrape runs on the workbench, away from this list.
          toast.success(t.pending.submitted, { id: "pending" });
        })
      }
      onRetryMany={async (input) =>
        await act(async () => {
          const { taskIds } = await api.pending.retryMany(input);
          requestScrapeLiveRunsRefresh();
          toast.success(t.pending.submittedMany(taskIds.length), { id: "pending" });
        })
      }
      onConfirmUncensored={async (input) => await act(() => api.pending.confirmUncensored(input))}
      onIgnore={async (ids) => await act(() => api.pending.ignore({ ids }))}
    />
  );
}

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});
