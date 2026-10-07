import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { LibrariesView } from "@mdcz/views/libraries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export function LibrariesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const librariesQ = useQuery({ queryKey: ["libraries"], queryFn: () => ipc.libraries.list() });
  const refresh = async () => await queryClient.invalidateQueries({ queryKey: ["libraries"] });

  return (
    <LibrariesView
      libraries={librariesQ.data?.libraries ?? []}
      loading={librariesQ.isLoading}
      errorMessage={librariesQ.error ? toErrorMessage(librariesQ.error) : null}
      showAutomation={false}
      onCreate={async (settings) => {
        await ipc.libraries.create(settings);
        toast.success(t.libraries.saved);
        await refresh();
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
