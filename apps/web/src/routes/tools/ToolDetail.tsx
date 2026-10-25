import { toErrorMessage } from "@mdcz/shared/error";
import { isRemoteAssetUrl } from "@mdcz/shared/mediaRef";
import type { PersonSyncJobDto, PersonSyncStartInput } from "@mdcz/shared/serverDtos";
import type { ToolId } from "@mdcz/shared/toolCatalog";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  BatchTranslateApplyResultItem,
  BatchTranslateScanItem,
  MediaServerConnectionCheckResult,
} from "@mdcz/shared/toolTypes";
import { useT } from "@mdcz/views/i18n";
import {
  AmazonPosterWorkspaceDetail,
  BatchNfoTranslatorWorkspaceDetail,
  CrawlerTesterDetail,
  PersonMediaLibraryDetail,
  type PersonServer,
  type PersonSyncMode,
  SingleFileScraperDetail,
  SymlinkManagerDetail,
  ToolDetailShell,
} from "@mdcz/views/tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { api, getLibraryAssetSrc, subscribeTaskNotifications } from "../../client";
import { browseDirectory, browseMediaFile } from "../../desktop";
import { queryKeys } from "../../lib/queryKeys";
import { AppLink, ErrorBanner } from "../../routeCommon";
import { toRunState } from "../toolsController";

const normalizePath = (value: string): string => value.trim().replace(/\\/gu, "/").replace(/\/+$/u, "");

const resolveToolImageCandidates = (candidates: string[], roots: Array<{ hostPath: string; id: string }>): string[] => {
  const normalizedRoots = roots
    .map((root) => ({ ...root, hostPath: normalizePath(root.hostPath) }))
    .filter((root) => root.id.trim().length > 0 && root.hostPath.length > 0)
    .sort((left, right) => right.hostPath.length - left.hostPath.length);

  return candidates
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return "";
      }
      if (isRemoteAssetUrl(trimmed)) {
        return trimmed;
      }

      const normalizedCandidate = normalizePath(trimmed);
      const root = normalizedRoots.find(
        (candidateRoot) =>
          normalizedCandidate === candidateRoot.hostPath ||
          normalizedCandidate.startsWith(`${candidateRoot.hostPath}/`),
      );
      if (!root) {
        return "";
      }

      const relativePath = normalizedCandidate.slice(root.hostPath.length).replace(/^\/+/u, "");
      return getLibraryAssetSrc({ rootId: root.id, path: relativePath });
    })
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
};

export const ToolDetail = ({ toolId }: { toolId: ToolId }) => {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [singleFileRootId, setSingleFileRootId] = useState("");
  const [personServer, setPersonServer] = useState<PersonServer | null>(null);
  const [jellyfinInfoMode, setJellyfinInfoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinPhotoMode, setJellyfinPhotoMode] = useState<PersonSyncMode>("missing");
  const [embyInfoMode, setEmbyInfoMode] = useState<PersonSyncMode>("missing");
  const [embyPhotoMode, setEmbyPhotoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinCheckResult, setJellyfinCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
  const [embyCheckResult, setEmbyCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
  const rootsQ = useQuery({ queryKey: queryKeys.mediaRoots.list, queryFn: () => api.mediaRoots.list() });
  const librariesQ = useQuery({ queryKey: queryKeys.libraries.all, queryFn: () => api.libraries.list() });
  const browserQ = useQuery({
    queryKey: queryKeys.browser.list(singleFileRootId),
    queryFn: () => api.browser.list({ rootId: singleFileRootId, relativePath: "" }),
    enabled: Boolean(singleFileRootId),
  });
  const executeM = useMutation({
    mutationFn: (input: Parameters<typeof api.tools.execute>[0]) => api.tools.execute(input),
    onSuccess: async (_response, input) => {
      if (input.toolId === "single-file-scraper") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.scrape.history() });
      }
    },
  });
  const personSyncQ = useQuery({
    queryKey: queryKeys.personSync,
    queryFn: () => api.tools.personSyncStatus(),
    enabled: toolId === "media-library-tools",
  });
  useEffect(() => {
    if (toolId !== "media-library-tools") return;
    return subscribeTaskNotifications({
      onNotification: (event) => {
        if (event.kind === "person-sync") queryClient.setQueryData(queryKeys.personSync, event.job);
        // Sync events have no replay, so every (re)connect rereads the job.
        else if (event.kind === "invalidate" && event.resources.includes("ready"))
          void queryClient.invalidateQueries({ queryKey: queryKeys.personSync });
      },
    });
  }, [queryClient, toolId]);
  const startPersonSyncM = useMutation({
    mutationFn: (input: PersonSyncStartInput) => api.tools.startPersonSync(input),
    // The stream may already have delivered a newer state of the same job.
    onSuccess: (job) =>
      queryClient.setQueryData(queryKeys.personSync, (current: PersonSyncJobDto | null | undefined) =>
        current?.id === job.id ? current : job,
      ),
  });
  const personSync = personSyncQ.data ?? null;
  const runningSync = personSync?.status === "running" ? personSync : null;
  // The server picker is locked while a sync runs, so a page reloaded mid-sync opens on that sync's server and,
  // until the user picks one, stays there to show its outcome.
  const activeServer = runningSync?.server ?? personServer ?? personSync?.server ?? "jellyfin";
  const syncRunning = (server: PersonServer, kind: PersonSyncJobDto["kind"]) =>
    runningSync?.server === server && runningSync.kind === kind;
  const syncProgress = (server: PersonServer) =>
    runningSync?.server === server && runningSync.total > 0 ? (runningSync.current / runningSync.total) * 100 : 0;
  const state = toRunState(executeM);
  const roots = rootsQ.data?.roots ?? [];
  const browserEntries = browserQ.data?.entries ?? [];
  const lookupAmazonPoster = useCallback(async (item: AmazonPosterScanItem): Promise<AmazonPosterLookupResult> => {
    const response = await api.tools.execute({
      toolId: "amazon-poster",
      action: "lookup",
      nfoPath: item.nfoPath,
      title: item.title,
    });
    return response.data as AmazonPosterLookupResult;
  }, []);
  const resolveAmazonPosterImageCandidates = useCallback(
    async (candidates: string[]) => resolveToolImageCandidates(candidates, roots),
    [roots],
  );

  return (
    <ToolDetailShell toolId={toolId}>
      {toolId === "single-file-scraper" && (
        <>
          {rootsQ.error && <ErrorBanner>{toErrorMessage(rootsQ.error)}</ErrorBanner>}
          <SingleFileScraperDetail
            browserEntries={browserEntries}
            roots={roots}
            libraries={librariesQ.data?.libraries ?? []}
            state={state}
            onBrowseFile={browseMediaFile}
            workbenchLink={
              <AppLink className="text-sm font-medium underline-offset-4 hover:underline" to="/workbench">
                {t.web.openWorkbench}
              </AppLink>
            }
            onRootChange={setSingleFileRootId}
            onRun={(input) => void executeM.mutate({ toolId, ...input })}
          />
        </>
      )}
      {toolId === "crawler-tester" && (
        <CrawlerTesterDetail state={state} onRun={(input) => void executeM.mutate({ toolId, ...input })} />
      )}
      {toolId === "symlink-manager" && (
        <SymlinkManagerDetail
          state={state}
          onBrowseSourceDir={browseDirectory}
          onBrowseDestDir={browseDirectory}
          onRun={(input) => void executeM.mutate({ toolId, ...input })}
        />
      )}
      {toolId === "batch-nfo-translator" && (
        <BatchNfoTranslatorWorkspaceDetail
          onApply={async (items, batchSize, mode) => {
            const response = await api.tools.execute({ toolId, action: "apply", mode, batchSize, items });
            return (response.data as { results: BatchTranslateApplyResultItem[] }).results;
          }}
          onBrowseDirectory={browseDirectory}
          onScan={async (directory, mode) => {
            const response = await api.tools.execute({ toolId, action: "scan", mode, directory });
            return (response.data as { items: BatchTranslateScanItem[] }).items;
          }}
        />
      )}
      {toolId === "media-library-tools" && (
        <>
          <PersonMediaLibraryDetail
            activeServer={activeServer}
            jellyfin={{
              checkPending: executeM.isPending && executeM.variables?.toolId === "media-library-tools",
              checkResult: jellyfinCheckResult,
              infoMode: jellyfinInfoMode,
              photoMode: jellyfinPhotoMode,
              infoSyncRunning: syncRunning("jellyfin", "info"),
              photoSyncRunning: syncRunning("jellyfin", "photo"),
              progress: syncProgress("jellyfin"),
              infoText: jellyfinInfoMode === "missing" ? t.web.jellyfinInfoMissing : t.web.jellyfinInfoAll,
              photoText: jellyfinPhotoMode === "missing" ? t.web.jellyfinPhotoMissing : t.web.jellyfinPhotoAll,
            }}
            emby={{
              checkPending: executeM.isPending && executeM.variables?.toolId === "media-library-tools",
              checkResult: embyCheckResult,
              infoMode: embyInfoMode,
              photoMode: embyPhotoMode,
              infoSyncRunning: syncRunning("emby", "info"),
              photoSyncRunning: syncRunning("emby", "photo"),
              progress: syncProgress("emby"),
              infoText: embyInfoMode === "missing" ? t.web.embyInfoMissing : t.web.embyInfoAll,
              photoText: embyPhotoMode === "missing" ? t.web.embyPhotoMissing : t.web.embyPhotoAll,
              photoNotice: t.web.photoAdminNotice,
            }}
            onCheck={async (server) => {
              const response = await executeM.mutateAsync({ toolId, server });
              const result = response.data as MediaServerConnectionCheckResult;
              if (server === "jellyfin") setJellyfinCheckResult(result);
              else setEmbyCheckResult(result);
            }}
            onStopPersonNameMatching={async () => {
              const response = await executeM.mutateAsync({
                toolId,
                server: "jellyfin",
                action: "stopPersonNameMatching",
              });
              setJellyfinCheckResult(response.data as MediaServerConnectionCheckResult);
            }}
            onInfoModeChange={(server, mode) => {
              if (server === "jellyfin") setJellyfinInfoMode(mode);
              else setEmbyInfoMode(mode);
            }}
            onPhotoModeChange={(server, mode) => {
              if (server === "jellyfin") setJellyfinPhotoMode(mode);
              else setEmbyPhotoMode(mode);
            }}
            onOpenSettings={() => void navigate({ to: "/settings", search: { section: "mediaServer" } })}
            onServerChange={setPersonServer}
            onSyncInfo={(server) =>
              startPersonSyncM.mutate({
                server,
                kind: "info",
                mode: server === "jellyfin" ? jellyfinInfoMode : embyInfoMode,
              })
            }
            onSyncPhoto={(server) =>
              startPersonSyncM.mutate({
                server,
                kind: "photo",
                mode: server === "jellyfin" ? jellyfinPhotoMode : embyPhotoMode,
              })
            }
          />
          {startPersonSyncM.error && <ErrorBanner>{toErrorMessage(startPersonSyncM.error)}</ErrorBanner>}
          {personSync?.server === activeServer && personSync.status === "failed" && personSync.error && (
            <ErrorBanner>{personSync.error}</ErrorBanner>
          )}
          {personSync?.server === activeServer && personSync.result ? (
            <p className="text-sm text-muted-foreground">{t.tools.personSyncSummary(personSync.result)}</p>
          ) : null}
        </>
      )}
      {toolId === "amazon-poster" && (
        <AmazonPosterWorkspaceDetail
          onBrowseDirectory={browseDirectory}
          onApply={async (items) => {
            const response = await api.tools.execute({ toolId, action: "apply", items });
            return (response.data as { results: AmazonPosterApplyResultItem[] }).results;
          }}
          onLookup={lookupAmazonPoster}
          resolveImageCandidates={resolveAmazonPosterImageCandidates}
          onScan={async (rootDir) => {
            const response = await api.tools.execute({ toolId, action: "scan", rootDir });
            return (response.data as { items: AmazonPosterScanItem[] }).items;
          }}
        />
      )}
    </ToolDetailShell>
  );
};
