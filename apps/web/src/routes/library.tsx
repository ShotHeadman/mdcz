import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import type { LibraryAvailabilityFilter } from "@mdcz/views/library";
import {
  chunkLibraryEntryIds,
  LibraryDeleteDialog,
  LibraryIndexView,
  mergeLibraryAvailability,
} from "@mdcz/views/library";
import { useInfiniteQuery, useQueries, useQueryClient } from "@tanstack/react-query";
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
    queryKey: queryKeys.library.search(query),
    queryFn: ({ pageParam }) => api.library.search({ cursor: pageParam, query, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const pageEntries = libraryQ.data?.pages.flatMap((page) => page.entries) ?? [];
  const availabilityQs = useQueries({
    queries: (libraryQ.data?.pages ?? []).flatMap((page) =>
      chunkLibraryEntryIds(page.entries.map((entry) => entry.id)).map((ids) => ({
        queryKey: [...queryKeys.library.search(query), "availability", ids],
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
        getImageSrc={(path, entry) => getLibraryAssetSrc({ format: "webp", path, rootId: entry.rootId, width: 160 })}
        hasMore={libraryQ.hasNextPage}
        isAvailabilityLoading={availabilityQs.some((availabilityQ) => availabilityQ.isLoading)}
        isLoading={libraryQ.isLoading}
        isLoadingMore={libraryQ.isFetchingNextPage}
        linkComponent={LibraryEntryLink}
        onAvailabilityFilterChange={setAvailabilityFilter}
        onDeleteEntry={setDeleteTarget}
        onLoadMore={() => {
          void libraryQ.fetchNextPage();
        }}
        onQueryChange={setQuery}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library.search(query) });
        }}
        query={query}
        total={libraryQ.data?.pages[0]?.total ?? 0}
      />
      <LibraryDeleteDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target) return;
          void deleteLibraryEntry(target, () => {
            setDeleteTarget(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          });
        }}
      />
    </>
  );
}

async function deleteLibraryEntry(entry: LibraryEntryDto, onSuccess: () => void) {
  try {
    await api.library.delete({ id: entry.id });
    toast.success("已从媒体库移除");
    onSuccess();
  } catch (error) {
    toast.error(toErrorMessage(error));
  }
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
  entry: { scrapeOutputId: string | null };
}) {
  if (!entry.scrapeOutputId) {
    return null;
  }

  return (
    <AppLink className={className} to={`/scrape/${encodeURIComponent(entry.scrapeOutputId)}`}>
      {children}
    </AppLink>
  );
}
