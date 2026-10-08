import { toErrorMessage } from "@mdcz/shared/error";
import { prepareMaintenanceSetup } from "@mdcz/views/adapters";
import { useT } from "@mdcz/views/i18n";
import { LibrariesView } from "@mdcz/views/libraries";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export function LibrariesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const librariesQ = useQuery({ queryKey: ["libraries"], queryFn: () => ipc.libraries.list() });
  const libraries = librariesQ.data?.libraries ?? [];
  const summaryQs = useQueries({
    queries: libraries.map((library) => ({
      queryKey: ["library", "summary", library.id],
      queryFn: () => ipc.library.summary({ libraryId: library.id }),
    })),
  });
  const pendingQ = useQuery({ queryKey: ["pending", "list"], queryFn: () => ipc.pending.list() });
  const pendingCounts: Record<string, number> = {};
  for (const item of pendingQ.data?.items ?? [])
    if (item.libraryId) pendingCounts[item.libraryId] = (pendingCounts[item.libraryId] ?? 0) + 1;
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: ["libraries"] });

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
      showAutomation={false}
      onCreate={async (settings) => {
        const created = await ipc.libraries.create(settings);
        toast.success(t.libraries.saved);
        await refresh();
        return created;
      }}
      onUpdate={async (id, settings) => {
        await ipc.libraries.update(id, settings);
        toast.success(t.libraries.saved);
        await refresh();
      }}
      onDelete={async (id) => {
        try {
          await ipc.libraries.delete(id);
          toast.success(t.libraries.deleted);
          await refresh();
        } catch (error) {
          toast.error(toErrorMessage(error));
        }
      }}
      onPreviewNaming={async (settings) => (await ipc.libraries.previewNaming(settings)).items}
      browseDirectory={async () => (await ipc.file.browse("directory")).paths?.[0]?.trim() || null}
    />
  );
}

export const Route = createFileRoute("/libraries")({
  component: LibrariesPage,
});
