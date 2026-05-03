import { toErrorMessage } from "@mdcz/shared/error";
import { LibraryDetailView } from "@mdcz/views/library";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../client";
import { AppLink } from "./Common";

export function LibraryDetailPage() {
  const id = decodeURIComponent(window.location.pathname.replace(/^\/library\//u, ""));
  const detailQ = useQuery({
    queryKey: ["library", "detail", id],
    queryFn: () => api.library.detail({ id }),
    retry: false,
  });
  const refreshMutation = useMutation({
    mutationFn: () => api.library.refresh({ id }),
    onSuccess: () => void detailQ.refetch(),
  });
  const rescanMutation = useMutation({ mutationFn: () => api.library.rescan({ id }) });
  const entry = detailQ.data?.entry ?? null;

  return (
    <LibraryDetailView
      backLink={
        <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
          返回媒体库
        </AppLink>
      }
      browserLink={
        entry ? (
          <AppLink
            className="font-medium text-foreground underline-offset-4 hover:underline"
            search={{ rootId: entry.rootId, path: entry.directory }}
            to="/browser"
          >
            浏览目录
          </AppLink>
        ) : null
      }
      entry={entry}
      errorMessage={detailQ.error ? toErrorMessage(detailQ.error) : null}
      isLoading={detailQ.isLoading}
      onRefresh={() => void refreshMutation.mutate()}
      onRescan={() => void rescanMutation.mutate()}
      taskLink={
        entry?.taskId ? (
          <AppLink
            className="font-medium text-foreground underline-offset-4 hover:underline"
            to={`/tasks/${entry.taskId}`}
          >
            查看任务
          </AppLink>
        ) : null
      }
    />
  );
}
