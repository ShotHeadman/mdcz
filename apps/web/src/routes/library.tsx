import { toErrorMessage } from "@mdcz/shared/error";
import type { LibraryEditJobDto, LibraryEditStartInput } from "@mdcz/shared/libraryEdit";
import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import { startHealthFix } from "@mdcz/views/adapters";
import { useT } from "@mdcz/views/i18n";
import type { LibraryAvailabilityFilter } from "@mdcz/views/library";
import {
  chunkLibraryEntryIds,
  createLibraryBrowseControls,
  LibraryDeleteDialog,
  LibraryEditDialog,
  LibraryIndexView,
  mergeLibraryAvailability,
  parseLibraryBrowseSearch,
  toLibraryListScope,
  useLibraryView,
} from "@mdcz/views/library";
import { selectMaintenanceExecutionStatus, useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
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
  const { libraryId, actor, studio, tag } = scope;
  const libraryView = useLibraryView();
  const maintenanceStatus = useMaintenanceStore(selectMaintenanceExecutionStatus);
  const isScraping = useScrapeStore(selectIsScraping);
  const ports = useMemo(() => createWebWorkbenchPorts(), []);
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<LibraryAvailabilityFilter>("all");
  const [deleteTargets, setDeleteTargets] = useState<LibraryEntryDto[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editTargets, setEditTargets] = useState<LibraryEntryDto[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showEditJob, setShowEditJob] = useState(true);
  const editSource = useRef<{ selected?: LibraryEntryDto[]; scope: typeof scope; query: string }>(null);
  const readEditStatus = async () => {
    const before = queryClient.getQueryData<LibraryEditJobDto | null>(queryKeys.libraryEdit);
    const response = await api.library.edit.status();
    const current = queryClient.getQueryData<LibraryEditJobDto | null>(queryKeys.libraryEdit);
    return current !== before && current !== undefined ? current : response;
  };
  const editStatusQ = useQuery({
    queryKey: queryKeys.libraryEdit,
    queryFn: readEditStatus,
    enabled: editOpen,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2_000 : false),
  });
  const configQ = useQuery({ queryKey: queryKeys.config.current, queryFn: () => api.config.read(), enabled: editOpen });
  const collectEditTargets = async () => {
    const source = editSource.current;
    if (!source) return;
    const matches: LibraryEntryDto[] = [];
    if (source.selected) matches.push(...source.selected);
    else {
      let cursor: string | undefined;
      do {
        const page = await api.library.list({ cursor, query: source.query, limit: 500, ...source.scope });
        matches.push(...page.entries);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    setEditTargets(matches);
  };
  const openEdit = async (selected?: LibraryEntryDto[]) => {
    editSource.current = { selected, scope, query };
    setEditOpen(true);
    setEditLoading(true);
    setEditError(null);
    setEditTargets([]);
    setShowEditJob(true);
    try {
      const job = await queryClient.fetchQuery({
        queryKey: queryKeys.libraryEdit,
        queryFn: readEditStatus,
        staleTime: 0,
      });
      if (!job) await collectEditTargets();
    } catch (error) {
      setEditError(toErrorMessage(error));
    } finally {
      setEditLoading(false);
    }
  };
  const editM = useMutation({
    mutationFn: (input: LibraryEditStartInput) => api.library.edit.start(input),
    onMutate: () => setEditError(null),
    onSuccess: async () => {
      setShowEditJob(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryEdit });
    },
    onError: (error) => setEditError(toErrorMessage(error)),
  });
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
          ...libraryView,
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
          onIgnore: async (health) => {
            await api.library.ignoreHealth({ libraryId, actor, studio, tag, query, health });
            await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          },
          onRestore: async () => {
            await api.library.restoreIgnored({ libraryId, actor, studio, tag, query });
            await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
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
        onEditEntries={(entries) => void openEdit(entries)}
        onEditAll={() => openEdit()}
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
      <LibraryEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entries={editTargets}
        ignoredFields={configQ.data?.download.nfoIgnoreFields ?? []}
        submitting={editM.isPending}
        loading={editLoading || configQ.isLoading}
        error={
          editError ||
          (configQ.error ? toErrorMessage(configQ.error) : null) ||
          (editStatusQ.error ? toErrorMessage(editStatusQ.error) : null)
        }
        blockedReason={
          isScraping
            ? t.workbench.taskConflict.scrape
            : maintenanceStatus !== "idle"
              ? t.workbench.taskConflict.maintenance
              : configQ.error
                ? toErrorMessage(configQ.error)
                : undefined
        }
        job={editStatusQ.data?.status === "running" || showEditJob ? (editStatusQ.data ?? null) : null}
        onSubmit={(input) => editM.mutate(input)}
        onNewEdit={() => {
          setEditLoading(true);
          setEditError(null);
          void collectEditTargets()
            .then(() => setShowEditJob(false))
            .catch((error) => setEditError(toErrorMessage(error)))
            .finally(() => setEditLoading(false));
        }}
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
