import { toErrorMessage } from "@mdcz/shared/error";
import type {
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  BatchTranslateApplyResultItem,
  BatchTranslateScanItem,
  EmbyConnectionCheckResult,
  JellyfinConnectionCheckResult,
} from "@mdcz/shared/ipcTypes";
import type { ToolId } from "@mdcz/shared/toolCatalog";
import {
  AmazonPosterWorkspaceDetail,
  BatchNfoTranslatorWorkspaceDetail,
  CrawlerTesterDetail,
  type FileCleanerCandidateView,
  FileCleanerWorkspaceDetail,
  MissingNumberFinderDetail,
  PersonMediaLibraryDetail,
  type PersonServer,
  type PersonSyncMode,
  SingleFileScraperDetail,
  SymlinkManagerDetail,
  ToolDetailShell,
} from "@mdcz/views/tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "../../client";
import { AppLink, ErrorBanner } from "../../routeCommon";
import {
  fileCleanerCandidatesFromResponse,
  formatToolBytes,
  toMediaServerCheckResult,
  toRunState,
} from "../toolsController";

export const ToolDetail = ({ toolId }: { toolId: ToolId }) => {
  const queryClient = useQueryClient();
  const [singleFileRootId, setSingleFileRootId] = useState("");
  const [fileCleanerCandidates, setFileCleanerCandidates] = useState<FileCleanerCandidateView[]>([]);
  const [batchItems, setBatchItems] = useState<BatchTranslateScanItem[]>([]);
  const [batchResults, setBatchResults] = useState<BatchTranslateApplyResultItem[]>([]);
  const [amazonDialogOpen, setAmazonDialogOpen] = useState(false);
  const [amazonItems, setAmazonItems] = useState<AmazonPosterScanItem[]>([]);
  const [personServer, setPersonServer] = useState<PersonServer>("jellyfin");
  const [jellyfinInfoMode, setJellyfinInfoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinPhotoMode, setJellyfinPhotoMode] = useState<PersonSyncMode>("missing");
  const [embyInfoMode, setEmbyInfoMode] = useState<PersonSyncMode>("missing");
  const [embyPhotoMode, setEmbyPhotoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinCheckResult, setJellyfinCheckResult] = useState<JellyfinConnectionCheckResult | null>(null);
  const [embyCheckResult, setEmbyCheckResult] = useState<EmbyConnectionCheckResult | null>(null);
  const [jellyfinMessage, setJellyfinMessage] = useState<string | null>(null);
  const [embyMessage, setEmbyMessage] = useState<string | null>(null);
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const browserQ = useQuery({
    queryKey: ["browser", singleFileRootId],
    queryFn: () => api.browser.list({ rootId: singleFileRootId, relativePath: "" }),
    enabled: Boolean(singleFileRootId),
    retry: false,
  });
  const executeM = useMutation({
    mutationFn: (input: Parameters<typeof api.tools.execute>[0]) => api.tools.execute(input),
    onSuccess: async (_response, input) => {
      if (input.toolId === "single-file-scraper") {
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
        await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
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
                打开工作台
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
      {toolId === "missing-number-finder" && (
        <MissingNumberFinderDetail state={state} onRun={(input) => void executeM.mutate({ toolId, ...input })} />
      )}
      {toolId === "symlink-manager" && (
        <SymlinkManagerDetail state={state} onRun={(input) => void executeM.mutate({ toolId, ...input })} />
      )}
      {toolId === "file-cleaner" && (
        <FileCleanerWorkspaceDetail
          candidates={fileCleanerCandidates}
          deleting={executeM.isPending}
          formatBytes={formatToolBytes}
          roots={roots}
          scanning={executeM.isPending}
          onDelete={async () => {
            const lastInput = executeM.variables;
            if (!lastInput || lastInput.toolId !== "file-cleaner") return;
            await executeM.mutateAsync({ ...lastInput, dryRun: false });
            setFileCleanerCandidates([]);
          }}
          onScan={async (input) => {
            const response = await executeM.mutateAsync({
              toolId,
              rootId: input.rootId,
              relativePath: input.relativePath,
              extensions: input.extensions,
              dryRun: true,
              recursive: input.includeSubdirs,
            });
            setFileCleanerCandidates(fileCleanerCandidatesFromResponse(response));
          }}
        />
      )}
      {toolId === "batch-nfo-translator" && (
        <BatchNfoTranslatorWorkspaceDetail
          applying={executeM.isPending}
          items={batchItems}
          results={batchResults}
          scanning={executeM.isPending}
          onApply={async (items) => {
            const response = await executeM.mutateAsync({ toolId, action: "apply", items });
            const data = response.data as { results?: BatchTranslateApplyResultItem[] } | undefined;
            setBatchResults(data?.results ?? []);
          }}
          onScan={async (directory) => {
            const response = await executeM.mutateAsync({ toolId, action: "scan", directory });
            const data = response.data as { items?: BatchTranslateScanItem[] } | undefined;
            setBatchItems(data?.items ?? []);
            setBatchResults([]);
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
              infoText:
                jellyfinInfoMode === "missing"
                  ? "仅补全缺失的演员简介与基础资料。"
                  : "按当前抓取结果更新演员简介与基础资料。",
              photoText:
                jellyfinPhotoMode === "missing" ? "仅为缺少头像的演员补充头像。" : "按当前抓取结果重新同步演员头像。",
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
              infoText:
                embyInfoMode === "missing"
                  ? "仅补全缺失的演员简介与基础资料，并保留未变更字段。"
                  : "按当前抓取结果更新演员简介与基础资料，并按同步字段写回 Emby。",
              photoText:
                embyPhotoMode === "missing" ? "仅为缺少头像的演员补充头像。" : "按当前抓取结果重新同步演员头像。",
              photoNotice: "人物头像上传通常需要管理员 API Key。若返回 401 或 403，请改用管理员 API Key 后重试。",
            }}
            onCheck={async (server) => {
              const response = await executeM.mutateAsync({ toolId, server, action: "check", mode: "missing" });
              const result = toMediaServerCheckResult(server, response);
              if (server === "jellyfin") {
                setJellyfinCheckResult(result as JellyfinConnectionCheckResult);
                setJellyfinMessage(response.message);
              } else {
                setEmbyCheckResult(result as EmbyConnectionCheckResult);
                setEmbyMessage(response.message);
              }
            }}
            onInfoModeChange={(server, mode) => {
              if (server === "jellyfin") setJellyfinInfoMode(mode);
              else setEmbyInfoMode(mode);
            }}
            onPhotoModeChange={(server, mode) => {
              if (server === "jellyfin") setJellyfinPhotoMode(mode);
              else setEmbyPhotoMode(mode);
            }}
            onServerChange={setPersonServer}
            onSyncInfo={async (server) => {
              const mode = server === "jellyfin" ? jellyfinInfoMode : embyInfoMode;
              const response = await executeM.mutateAsync({ toolId, server, action: "sync-info", mode });
              if (server === "jellyfin") setJellyfinMessage(response.message);
              else setEmbyMessage(response.message);
            }}
            onSyncPhoto={async (server) => {
              const mode = server === "jellyfin" ? jellyfinPhotoMode : embyPhotoMode;
              const response = await executeM.mutateAsync({ toolId, server, action: "sync-photo", mode });
              if (server === "jellyfin") setJellyfinMessage(response.message);
              else setEmbyMessage(response.message);
            }}
          />
          <p className="text-sm text-muted-foreground">{personServer === "jellyfin" ? jellyfinMessage : embyMessage}</p>
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
