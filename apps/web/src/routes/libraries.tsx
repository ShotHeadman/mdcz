import { toErrorMessage } from "@mdcz/shared/error";
import { prepareMaintenanceSetup } from "@mdcz/views/adapters";
import { LibrariesView } from "@mdcz/views/libraries";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../client";
import { browseDirectory, desktop } from "../desktop";
import { queryKeys } from "../lib/queryKeys";

export function LibrariesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list() });
  const libraries = librariesQ.data?.libraries ?? [];
  const summaryQs = useQueries({
    queries: libraries.map((library) => ({
      queryKey: queryKeys.library.summary(library.id),
      queryFn: () => api.library.summary({ libraryId: library.id }),
    })),
  });
  const pendingQ = useQuery({ queryKey: queryKeys.pending.all, queryFn: () => api.pending.list() });
  // Library watching and downloader callbacks are server automation; desktop runs none.
  const integrationsQ = useQuery({
    queryKey: queryKeys.integrations.status,
    queryFn: () => api.integrations.status(),
    refetchInterval: 30_000,
    enabled: !desktop,
  });
  const pendingCounts: Record<string, number> = {};
  for (const item of pendingQ.data?.items ?? [])
    if (item.libraryId) pendingCounts[item.libraryId] = (pendingCounts[item.libraryId] ?? 0) + 1;
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.libraries.all });

  return (
    <LibrariesView
      libraries={libraries}
      summaries={Object.fromEntries(libraries.map((library, index) => [library.id, summaryQs[index]?.data]))}
      pendingCounts={pendingCounts}
      cloudDriveEvents={integrationsQ.data?.cloudDrive.libraries}
      onImport={(library) => {
        prepareMaintenanceSetup({ scanDir: library.sourcePath, libraryId: library.id, presetId: "import_local" });
        void navigate({ to: "/workbench", search: { intent: "maintenance" } });
      }}
      onViewIssue={(library, health) => void navigate({ to: "/library", search: { libraryId: library.id, health } })}
      onViewPending={() => void navigate({ to: "/pending" })}
      loading={librariesQ.isLoading}
      errorMessage={librariesQ.error ? toErrorMessage(librariesQ.error) : null}
      showAutomation={!desktop}
      onCreate={async (settings) => {
        const created = await api.libraries.create(settings);
        await refresh();
        return created;
      }}
      onUpdate={async (id, settings) => {
        await api.libraries.update({ id, settings });
        await refresh();
      }}
      onDelete={async (id) => {
        try {
          await api.libraries.delete({ id });
          await refresh();
        } catch (error) {
          toast.error(toErrorMessage(error), { id: "library-settings" });
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
      browseDirectory={browseDirectory}
      probeStubs={async (sourcePath) => (await api.libraries.probeStubs({ sourcePath })).hasStubs}
    />
  );
}

export const Route = createFileRoute("/libraries")({
  component: LibrariesPage,
});
