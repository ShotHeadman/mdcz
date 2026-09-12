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
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { api, getLibraryAssetSrc } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { AppLink } from "../routeCommon";

export function LibraryPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntryDto | null>(null);
  const libraryQ = useInfiniteQuery({
    queryKey: queryKeys.library.list(query),
    queryFn: ({ pageParam }) => api.library.list({ cursor: pageParam, query, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async (entry: LibraryEntryDto) => {
      await api.library.delete({ id: entry.id });
    },
    onSuccess: async () => {
      toast.success("已从媒体库移除");
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
    onError: (error) => {
      toast.error(toErrorMessage(error));
    },
  });
  const pageEntries = libraryQ.data?.pages.flatMap((page) => page.entries) ?? [];
  const availabilityQs = useQueries({
    queries: (libraryQ.data?.pages ?? []).flatMap((page) =>
      chunkLibraryEntryIds(page.entries.map((entry) => entry.id)).map((ids) => ({
        queryKey: [...queryKeys.library.list(query), "availability", ids],
        queryFn: async () => await api.library.availability({ ids }),
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
          getLibraryAssetSrc({
            format: "webp",
            path,
            rootId:
              entry.thumbnailRootId ?? entry.fileRefs.find((file) => file.id === entry.displayFileId)?.rootId ?? "",
            width: 160,
          })
        }
        hasMore={libraryQ.hasNextPage}
        isAvailabilityLoading={availabilityQs.some((availabilityQ) => availabilityQ.isLoading)}
        isLoading={libraryQ.isLoading}
        isLoadingMore={libraryQ.isFetchingNextPage}
        linkComponent={LibraryEntryLink}
        onAvailabilityFilterChange={setAvailabilityFilter}
        onDeleteEntry={setDeleteTarget}
        onRemoveFile={async (input) => {
          await api.library.removeFile(input);
          await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
        }}
        onRelinkFile={async (input) => {
          await api.library.relink(input);
          await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
        }}
        onLoadMore={() => {
          void libraryQ.fetchNextPage();
        }}
        onQueryChange={setQuery}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library.list(query) });
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
          if (!deleteLibraryM.isPending) setDeleteTarget(null);
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

function LibraryEntryLink({
  children,
  className,
  entry,
}: {
  children: ReactNode;
  className?: string;
  entry: LibraryEntryDto;
}) {
  const outcomeId = entry.fileRefs.find((file) => file.id === entry.displayFileId)?.scrapeOutcomeId;
  if (!outcomeId) {
    return null;
  }

  return (
    <AppLink className={className} to={`/scrape/${encodeURIComponent(outcomeId)}`}>
      {children}
    </AppLink>
  );
}
