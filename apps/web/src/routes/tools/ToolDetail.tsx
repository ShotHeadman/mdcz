import { toErrorMessage } from "@mdcz/shared/error";
import type {
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  BatchTranslateApplyResultItem,
  BatchTranslateScanItem,
  MediaServerConnectionCheckResult,
  PersonSyncResult,
} from "@mdcz/shared/ipcTypes";
import type { ToolId } from "@mdcz/shared/toolCatalog";
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
import { useCallback, useState } from "react";
import { api, getLibraryAssetSrc } from "../../client";
import { queryKeys } from "../../lib/queryKeys";
import { AppLink, ErrorBanner } from "../../routeCommon";
import { toRunState } from "../toolsController";

const isRemoteImageCandidate = (value: string): boolean => /^(?:https?:\/\/|data:|blob:)/iu.test(value.trim());

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
      if (isRemoteImageCandidate(trimmed)) {
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
  const [batchItems, setBatchItems] = useState<BatchTranslateScanItem[]>([]);
  const [amazonDialogOpen, setAmazonDialogOpen] = useState(false);
  const [amazonItems, setAmazonItems] = useState<AmazonPosterScanItem[]>([]);
  const [personServer, setPersonServer] = useState<PersonServer>("jellyfin");
  const [jellyfinInfoMode, setJellyfinInfoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinPhotoMode, setJellyfinPhotoMode] = useState<PersonSyncMode>("missing");
  const [embyInfoMode, setEmbyInfoMode] = useState<PersonSyncMode>("missing");
  const [embyPhotoMode, setEmbyPhotoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinCheckResult, setJellyfinCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
  const [embyCheckResult, setEmbyCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
  const [lastPersonSync, setLastPersonSync] = useState<{ server: PersonServer; result: PersonSyncResult } | null>(null);
  const rootsQ = useQuery({ queryKey: queryKeys.mediaRoots.list, queryFn: () => api.mediaRoots.list(), retry: false });
  const browserQ = useQuery({
    queryKey: queryKeys.browser.list(singleFileRootId),
    queryFn: () => api.browser.list({ rootId: singleFileRootId, relativePath: "" }),
    enabled: Boolean(singleFileRootId),
    retry: false,
  });
  const executeM = useMutation({
    mutationFn: (input: Parameters<typeof api.tools.execute>[0]) => api.tools.execute(input),
    onSuccess: async (_response, input) => {
      if (input.toolId === "single-file-scraper") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.scrape.history() });
      }
    },
  });
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
            state={state}
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
        <SymlinkManagerDetail state={state} onRun={(input) => void executeM.mutate({ toolId, ...input })} />
      )}
      {toolId === "batch-nfo-translator" && (
        <BatchNfoTranslatorWorkspaceDetail
          items={batchItems}
          onApply={async (items, batchSize, mode) => {
            const response = await executeM.mutateAsync({ toolId, action: "apply", mode, batchSize, items });
            const data = response.data as { results?: BatchTranslateApplyResultItem[] } | undefined;
            return data?.results ?? [];
          }}
          scanning={executeM.isPending && executeM.variables?.toolId === toolId && executeM.variables.action === "scan"}
          onScan={async (directory, mode) => {
            const response = await executeM.mutateAsync({ toolId, action: "scan", mode, directory });
            const data = response.data as { items?: BatchTranslateScanItem[] } | undefined;
            setBatchItems(data?.items ?? []);
          }}
        />
      )}
      {toolId === "media-library-tools" && (
        <>
          <PersonMediaLibraryDetail
            activeServer={personServer}
            jellyfin={{
              checkPending: executeM.isPending && executeM.variables?.toolId === "media-library-tools",
              checkResult: jellyfinCheckResult,
              infoMode: jellyfinInfoMode,
              photoMode: jellyfinPhotoMode,
              infoSyncRunning:
                executeM.isPending &&
                executeM.variables?.toolId === "media-library-tools" &&
                executeM.variables.action === "sync-info" &&
                executeM.variables.server === "jellyfin",
              photoSyncRunning:
                executeM.isPending &&
                executeM.variables?.toolId === "media-library-tools" &&
                executeM.variables.action === "sync-photo" &&
                executeM.variables.server === "jellyfin",
              progress: 0,
              infoText: jellyfinInfoMode === "missing" ? t.web.jellyfinInfoMissing : t.web.jellyfinInfoAll,
              photoText: jellyfinPhotoMode === "missing" ? t.web.jellyfinPhotoMissing : t.web.jellyfinPhotoAll,
            }}
            emby={{
              checkPending: executeM.isPending && executeM.variables?.toolId === "media-library-tools",
              checkResult: embyCheckResult,
              infoMode: embyInfoMode,
              photoMode: embyPhotoMode,
              infoSyncRunning:
                executeM.isPending &&
                executeM.variables?.toolId === "media-library-tools" &&
                executeM.variables.action === "sync-info" &&
                executeM.variables.server === "emby",
              photoSyncRunning:
                executeM.isPending &&
                executeM.variables?.toolId === "media-library-tools" &&
                executeM.variables.action === "sync-photo" &&
                executeM.variables.server === "emby",
              progress: 0,
              infoText: embyInfoMode === "missing" ? t.web.embyInfoMissing : t.web.embyInfoAll,
              photoText: embyPhotoMode === "missing" ? t.web.embyPhotoMissing : t.web.embyPhotoAll,
              photoNotice: t.web.photoAdminNotice,
            }}
            onCheck={async (server) => {
              const response = await executeM.mutateAsync({ toolId, server, action: "check", mode: "missing" });
              const result = response.data as MediaServerConnectionCheckResult;
              if (server === "jellyfin") setJellyfinCheckResult(result);
              else setEmbyCheckResult(result);
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
            onSyncInfo={async (server) => {
              const mode = server === "jellyfin" ? jellyfinInfoMode : embyInfoMode;
              const response = await executeM.mutateAsync({ toolId, server, action: "sync-info", mode });
              setLastPersonSync({ server, result: response.data as PersonSyncResult });
            }}
            onSyncPhoto={async (server) => {
              const mode = server === "jellyfin" ? jellyfinPhotoMode : embyPhotoMode;
              const response = await executeM.mutateAsync({ toolId, server, action: "sync-photo", mode });
              setLastPersonSync({ server, result: response.data as PersonSyncResult });
            }}
          />
          {lastPersonSync?.server === personServer ? (
            <p className="text-sm text-muted-foreground">{t.tools.personSyncSummary(lastPersonSync.result)}</p>
          ) : null}
        </>
      )}
      {toolId === "amazon-poster" && (
        <AmazonPosterWorkspaceDetail
          dialogOpen={amazonDialogOpen}
          items={amazonItems}
          scanning={executeM.isPending}
          onApply={async (items) => {
            await executeM.mutateAsync({ toolId, action: "apply", items });
            setAmazonDialogOpen(false);
          }}
          onDialogOpenChange={setAmazonDialogOpen}
          onLookup={lookupAmazonPoster}
          resolveImageCandidates={resolveAmazonPosterImageCandidates}
          onScan={async (rootDir) => {
            const response = await executeM.mutateAsync({ toolId, action: "scan", rootDir });
            const data = response.data as { items?: AmazonPosterScanItem[] } | undefined;
            setAmazonItems(data?.items ?? []);
            setAmazonDialogOpen(true);
          }}
        />
      )}
    </ToolDetailShell>
  );
};
