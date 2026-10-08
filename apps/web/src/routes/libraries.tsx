import { toErrorMessage } from "@mdcz/shared/error";
import { prepareMaintenanceSetup } from "@mdcz/views/adapters";
import { useT } from "@mdcz/views/i18n";
import { AutomationAccessPanel, LibrariesView } from "@mdcz/views/libraries";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";

export function LibrariesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list(), retry: false });
  const keysQ = useQuery({ queryKey: queryKeys.libraries.apiKeys, queryFn: () => api.apiKeys.list(), retry: false });
  const libraries = librariesQ.data?.libraries ?? [];
  const summaryQs = useQueries({
    queries: libraries.map((library) => ({
      queryKey: queryKeys.library.summary(library.id),
      queryFn: () => api.library.summary({ libraryId: library.id }),
      retry: false,
    })),
  });
  const pendingQ = useQuery({ queryKey: queryKeys.pending.all, queryFn: () => api.pending.list(), retry: false });
  const pendingCounts: Record<string, number> = {};
  for (const item of pendingQ.data?.items ?? [])
    if (item.libraryId) pendingCounts[item.libraryId] = (pendingCounts[item.libraryId] ?? 0) + 1;
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.all });
  const revokeM = useMutation({
    mutationFn: async (id: string) => await api.apiKeys.delete({ id }),
    onSuccess: async () => await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.apiKeys }),
    onError: (error) => toast.error(toErrorMessage(error)),
  });

  return (
    <LibrariesView
      libraries={libraries}
      summaries={Object.fromEntries(libraries.map((library, index) => [library.id, summaryQs[index]?.data]))}
      pendingCounts={pendingCounts}
      onImport={(library) => {
        prepareMaintenanceSetup({ scanDir: library.sourcePath, libraryId: library.id, presetId: "import_local" });
        void navigate({ to: "/workbench", search: { intent: "maintenance" } });
      }}
      onViewIssue={(library, health) => void navigate({ to: "/library", search: { libraryId: library.id, health } })}
      onViewPending={() => void navigate({ to: "/pending" })}
      loading={librariesQ.isLoading}
      errorMessage={librariesQ.error ? toErrorMessage(librariesQ.error) : null}
      showAutomation
      onCreate={async (settings) => {
        const created = await api.libraries.create(settings);
        toast.success(t.libraries.saved);
        await refresh();
        return created;
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
