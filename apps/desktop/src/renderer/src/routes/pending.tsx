import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { PendingView } from "@mdcz/views/pending";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export function PendingPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQ = useQuery({ queryKey: ["pending", "list"], queryFn: () => ipc.pending.list() });
  const librariesQ = useQuery({ queryKey: ["libraries"], queryFn: () => ipc.libraries.list() });
  const items = listQ.data?.items ?? [];
  const activeId = selectedId && items.some((item) => item.id === selectedId) ? selectedId : (items[0]?.id ?? null);
  const detailQ = useQuery({
    queryKey: ["pending", "detail", activeId],
    queryFn: () => ipc.pending.detail(activeId ?? ""),
    enabled: Boolean(activeId),
  });
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ["pending"] });
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
      onRetry={async (input) => await act(() => ipc.pending.retry(input), t.pending.submitted)}
      onConfirmUncensored={async (input) => await act(() => ipc.pending.confirmUncensored(input), t.pending.confirmed)}
      onIgnore={async (id) => await act(() => ipc.pending.ignore(id), t.pending.ignored)}
    />
  );
}

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});
