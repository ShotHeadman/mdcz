import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { AutomationAccessPanel, LibrariesView } from "@mdcz/views/libraries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";

export function LibrariesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list(), retry: false });
  const keysQ = useQuery({ queryKey: queryKeys.libraries.apiKeys, queryFn: () => api.apiKeys.list(), retry: false });
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.all });
  const revokeM = useMutation({
    mutationFn: async (id: string) => await api.apiKeys.delete({ id }),
    onSuccess: async () => await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.apiKeys }),
    onError: (error) => toast.error(toErrorMessage(error)),
  });

  return (
    <LibrariesView
      libraries={librariesQ.data?.libraries ?? []}
      loading={librariesQ.isLoading}
      errorMessage={librariesQ.error ? toErrorMessage(librariesQ.error) : null}
      showAutomation
      onCreate={async (settings) => {
        await api.libraries.create(settings);
        toast.success(t.libraries.saved);
        await refresh();
      }}
      onUpdate={async (id, settings) => {
        await api.libraries.update({ id, settings });
        toast.success(t.libraries.saved);
        await refresh();
      }}
      onDelete={async (id) => {
        try {
          await api.libraries.delete({ id });
          toast.success(t.libraries.deleted);
          await refresh();
        } catch (error) {
          toast.error(toErrorMessage(error));
        }
      }}
      onPreviewNaming={async (settings) => (await api.libraries.previewNaming(settings)).items}
      loadDirectorySuggestions={async (path) => {
        const result = await api.serverPaths.suggest({ path, intent: "workbench-output" });
        return {
          accessible: result.accessible,
          error: result.error,
          entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
        };
      }}
      accessPanel={
        <AutomationAccessPanel
          keys={keysQ.data?.keys ?? []}
          origin={window.location.origin}
          onCreate={async (name) => {
            const created = await api.apiKeys.create({ name });
            await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.apiKeys });
            return created.secret;
          }}
          onRevoke={async (id) => {
            await revokeM.mutateAsync(id);
          }}
        />
      }
    />
  );
}

export const Route = createFileRoute("/libraries")({
  component: LibrariesPage,
});
