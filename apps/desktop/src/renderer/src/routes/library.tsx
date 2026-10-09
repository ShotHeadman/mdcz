import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { startHealthFix } from "@mdcz/views/adapters";
import { useT } from "@mdcz/views/i18n";
import type { LibraryAvailabilityFilter } from "@mdcz/views/library";
import {
  chunkLibraryEntryIds,
  createLibraryBrowseControls,
  LibraryDeleteDialog,
  LibraryIndexView,
  mergeLibraryAvailability,
  parseLibraryBrowseSearch,
  toLibraryListScope,
} from "@mdcz/views/library";
import { selectIsScraping, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { createDesktopMaintenanceActionPort } from "@/adapters/ports";
import { ipc } from "@/client/ipc";
import { getImageSrc } from "@/utils/image";

export function LibraryPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const scope = toLibraryListScope(search);
  const isScraping = useScrapeStore(selectIsScraping);
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntryDto | null>(null);
  const queryClient = useQueryClient();
  const libraryQ = useInfiniteQuery({
    queryKey: ["library", "list", query, scope],
    queryFn: ({ pageParam }) => ipc.library.list({ cursor: pageParam, query, limit: 100, ...scope }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async (entry: LibraryEntryDto) => {
      await ipc.library.delete({ id: entry.id });
    },
    onSuccess: async () => {
      toast.success(t.desktop.removedFromLibrary);
      setDeleteTarget(null);
      await libraryQ.refetch();
      await queryClient.invalidateQueries({ queryKey: ["library", "availability"] });
    },
    onError: (error) => {
      toast.error(toErrorMessage(error));
    },
  });
  const pageEntries = libraryQ.data?.pages.flatMap((page) => page.entries) ?? [];
  const availabilityQs = useQueries({
    queries: (libraryQ.data?.pages ?? []).flatMap((page) =>
      chunkLibraryEntryIds(page.entries.map((entry) => entry.id)).map((ids) => ({
        queryKey: ["library", "availability", ids],
        queryFn: async () => await ipc.library.availability(ids),
        retry: false,
        staleTime: 30_000,
      })),
    ),
  });
  const librariesQ = useQuery({ queryKey: ["libraries"], queryFn: () => ipc.libraries.list() });
  const summaryQ = useQuery({
    queryKey: ["library", "summary", search.libraryId ?? ""],
    queryFn: () => ipc.library.summary({ libraryId: search.libraryId }),
  });
  const entries = mergeLibraryAvailability(
    pageEntries,
    availabilityQs.flatMap((availabilityQ) => availabilityQ.data ?? []),
  );

  return (
    <>
      <LibraryIndexView
        availabilityFilter={availabilityFilter}
        browse={createLibraryBrowseControls({
          search,
          libraries: librariesQ.data?.libraries ?? [],
          summary: summaryQ.data,
          update: (next) => void navigate({ to: "/library", search: next }),
          onFix: async (issue) => {
            const matches: LibraryEntryDto[] = [];
            let cursor: string | undefined;
            do {
              const page = await ipc.library.list({ cursor, query, limit: 500, ...scope, health: issue });
              matches.push(...page.entries);
              cursor = page.nextCursor ?? undefined;
            } while (cursor);
            await startHealthFix({
              issue,
              libraryId: search.libraryId,
              entries: matches,
              port: createDesktopMaintenanceActionPort(),
              isScraping,
              toast,
              toErrorMessage,
            });
            void navigate({ to: "/workbench", search: { intent: "maintenance" } });
          },
        })}
        entries={entries}
        errorMessage={libraryQ.error ? toErrorMessage(libraryQ.error) : null}
        getImageSrc={(path, entry) =>
          getImageSrc(
            path,
            entry.thumbnailRootId ?? entry.fileRefs.find((file) => file.id === entry.displayFileId)?.rootId ?? "",
          )
        }
        hasMore={libraryQ.hasNextPage}
        isAvailabilityLoading={availabilityQs.some((availabilityQ) => availabilityQ.isLoading)}
        isLoading={libraryQ.isLoading}
        isLoadingMore={libraryQ.isFetchingNextPage}
        onAvailabilityFilterChange={setAvailabilityFilter}
        onDeleteEntry={setDeleteTarget}
        onRemoveFile={async (input) => {
          await ipc.library.removeFile(input);
          await queryClient.invalidateQueries({ queryKey: ["library"] });
        }}
        onRelinkFile={async (input) => {
          await ipc.library.relinkFile(input);
          await queryClient.invalidateQueries({ queryKey: ["library"] });
        }}
        onLoadMore={() => {
          void libraryQ.fetchNextPage();
        }}
        onOpenFolder={(path) => {
          void ipc.app.showItemInFolder(path).catch((error: unknown) => {
            toast.error(toErrorMessage(error));
          });
        }}
        onQueryChange={setQuery}
        onRefresh={() => {
          void libraryQ.refetch();
          void queryClient.invalidateQueries({ queryKey: ["library", "availability"] });
        }}
        query={query}
        total={libraryQ.data?.pages[0]?.total ?? 0}
        fileCount={libraryQ.data?.pages[0]?.fileCount ?? 0}
        totalBytes={libraryQ.data?.pages[0]?.totalBytes ?? 0}
      />
      <LibraryDeleteDialog
        entry={deleteTarget}
        open={Boolean(deleteTarget)}
        submitting={deleteLibraryM.isPending}
        onCancel={() => {
          if (deleteLibraryM.isPending) return;
          setDeleteTarget(null);
        }}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target || deleteLibraryM.isPending) return;
          deleteLibraryM.mutate(target);
        }}
      />
    </>
  );
}

export const Route = createFileRoute("/library")({
  validateSearch: parseLibraryBrowseSearch,
  component: LibraryPage,
});
