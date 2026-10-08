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
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api, getLibraryAssetSrc } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { AppLink } from "../routeCommon";

export function LibraryPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const scope = toLibraryListScope(search);
  const isScraping = useScrapeStore(selectIsScraping);
  const ports = useMemo(() => createWebWorkbenchPorts(), []);
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntryDto | null>(null);
  const libraryQ = useInfiniteQuery({
    queryKey: queryKeys.library.list({ query, ...scope }),
    queryFn: ({ pageParam }) => api.library.list({ cursor: pageParam, query, limit: 100, ...scope }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async (entry: LibraryEntryDto) => {
      await api.library.delete({ id: entry.id });
    },
    onSuccess: async () => {
      toast.success(t.web.removedFromLibrary);
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
        queryKey: [...queryKeys.library.list({ query, ...scope }), "availability", ids],
        queryFn: async () => await api.library.availability({ ids }),
        retry: false,
        staleTime: 30_000,
      })),
    ),
  });
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list(), retry: false });
  const summaryQ = useQuery({
    queryKey: queryKeys.library.summary(search.libraryId),
    queryFn: () => api.library.summary({ libraryId: search.libraryId }),
    retry: false,
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
              const page = await api.library.list({ cursor, limit: 500, ...scope, health: issue });
              matches.push(...page.entries);
              cursor = page.nextCursor ?? undefined;
            } while (cursor);
            await startHealthFix({
              issue,
              libraryId: search.libraryId,
              entries: matches,
              port: ports.maintenance,
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
          void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
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
  validateSearch: parseLibraryBrowseSearch,
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
  return (
    <AppLink className={className} to={`/scrape/${encodeURIComponent(entry.displayFileId)}`}>
      {children}
    </AppLink>
  );
}
