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
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createWebWorkbenchPorts } from "../adapters/ports";
import { api, getLibraryAssetSrc } from "../client";
import { openFolder } from "../desktop";
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
  const [deleteTargets, setDeleteTargets] = useState<LibraryEntryDto[]>([]);
  // Only a refresh the user asks for skips the server's recent availability checks.
  const freshAvailability = useRef(false);
  const libraryQ = useInfiniteQuery({
    queryKey: queryKeys.library.list({ query, ...scope }),
    queryFn: ({ pageParam }) => api.library.list({ cursor: pageParam, query, limit: 100, ...scope }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const deleteLibraryM = useMutation({
    mutationFn: async (entries: LibraryEntryDto[]) => {
      await api.library.delete({ ids: entries.map((entry) => entry.id) });
    },
    onSuccess: async () => {
      setDeleteTargets([]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
    onError: (error) => {
      toast.error(toErrorMessage(error), { id: "library-entry" });
    },
  });
  const pageEntries = libraryQ.data?.pages.flatMap((page) => page.entries) ?? [];
  const availabilityQs = useQueries({
    queries: (libraryQ.data?.pages ?? []).flatMap((page) =>
      chunkLibraryEntryIds(page.entries.map((entry) => entry.id)).map((ids) => ({
        queryKey: [...queryKeys.library.list({ query, ...scope }), "availability", ids],
        queryFn: async () => await api.library.availability({ ids, fresh: freshAvailability.current }),
        staleTime: 30_000,
      })),
    ),
  });
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list() });
  const summaryQ = useQuery({
    queryKey: queryKeys.library.summary(search.libraryId),
    queryFn: () => api.library.summary({ libraryId: search.libraryId }),
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
          fixBlockedReason: isScraping ? t.workbench.taskConflict.scrape : undefined,
          onFix: async (issue) => {
            const matches: LibraryEntryDto[] = [];
            let cursor: string | undefined;
            do {
              const page = await api.library.list({ cursor, query, limit: 500, ...scope, health: issue });
              matches.push(...page.entries);
              cursor = page.nextCursor ?? undefined;
            } while (cursor);
            await startHealthFix({
              issue,
              libraryId: search.libraryId,
              entries: matches,
              port: ports.maintenance,
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
        onDeleteEntries={setDeleteTargets}
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
        onOpenFolder={openFolder}
        onQueryChange={setQuery}
        onRefresh={async () => {
          freshAvailability.current = true;
          try {
            await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          } finally {
            freshAvailability.current = false;
          }
        }}
        query={query}
        total={libraryQ.data?.pages[0]?.total ?? 0}
        fileCount={libraryQ.data?.pages[0]?.fileCount ?? 0}
        totalBytes={libraryQ.data?.pages[0]?.totalBytes ?? 0}
      />
      <LibraryDeleteDialog
        entries={deleteTargets}
        submitting={deleteLibraryM.isPending}
        onCancel={() => {
          if (!deleteLibraryM.isPending) setDeleteTargets([]);
        }}
        onConfirm={() => {
          if (!deleteLibraryM.isPending) deleteLibraryM.mutate(deleteTargets);
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
