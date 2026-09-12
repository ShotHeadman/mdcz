import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import type { LibraryAvailabilityFilter } from "@mdcz/views/library";
import {
  chunkLibraryEntryIds,
  LibraryDeleteDialog,
  LibraryIndexView,
  mergeLibraryAvailability,
} from "@mdcz/views/library";
import { useInfiniteQuery, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { getImageSrc } from "@/utils/image";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntryDto | null>(null);
  const queryClient = useQueryClient();
  const libraryQ = useInfiniteQuery({
    queryKey: ["library", "list", query],
    queryFn: ({ pageParam }) => ipc.library.list({ cursor: pageParam, query, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async (entry: LibraryEntryDto) => {
      await ipc.library.delete({ id: entry.id });
    },
    onSuccess: async () => {
      toast.success("已从媒体库移除");
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
  const entries = mergeLibraryAvailability(
    pageEntries,
    availabilityQs.flatMap((availabilityQ) => availabilityQ.data ?? []),
  );

  return (
    <>
      <LibraryIndexView
        availabilityFilter={availabilityFilter}
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
  component: LibraryPage,
});
