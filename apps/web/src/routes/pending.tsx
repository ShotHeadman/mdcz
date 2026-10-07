import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { PendingView } from "@mdcz/views/pending";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../client";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";
import { queryKeys } from "../lib/queryKeys";

export function PendingPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQ = useQuery({ queryKey: queryKeys.pending.all, queryFn: () => api.pending.list(), retry: false });
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list(), retry: false });
  const items = listQ.data?.items ?? [];
  const activeId = selectedId && items.some((item) => item.id === selectedId) ? selectedId : (items[0]?.id ?? null);
  const detailQ = useQuery({
    queryKey: queryKeys.pending.detail(activeId ?? ""),
    queryFn: () => api.pending.detail({ id: activeId ?? "" }),
    enabled: Boolean(activeId),
    retry: false,
  });
  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.pending.all });
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
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
        }, t.pending.submitted)
      }
      onConfirmUncensored={async (input) => await act(() => api.pending.confirmUncensored(input), t.pending.confirmed)}
      onIgnore={async (id) => await act(() => api.pending.ignore({ id }), t.pending.ignored)}
    />
  );
}

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});
