import type { LibraryEntryDto } from "@mdcz/shared/serverDtos";
import type { MediaServerConnectionCheckResult } from "@mdcz/shared/toolTypes";
import type { BriefDestination, BriefPort, CrawlerTestResult, SymlinkResult } from "@mdcz/views/brief";
import { useNavigate } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { useMemo } from "react";
import { api, getLibraryAssetSrc } from "../client";
import { desktop } from "../desktop";
import { requestScrapeLiveRunsRefresh } from "../hooks/useWebTaskSync";
import { refreshPendingQueries } from "../lib/pendingQueries";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { buildHref } from "../routeHelpers";
import { createWebSetupPort } from "./ports";

const isNotFound = (error: unknown): boolean => error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";

const splitHostPath = (path: string): { directory: string; name: string } => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // A file at the top of a drive or of `/` keeps the separator, so its directory stays a full path.
  const end = slash <= 0 || path[slash - 1] === ":" ? slash + 1 : slash;
  return { directory: path.slice(0, end), name: path.slice(slash + 1) };
};

const refreshConfig = async () => await queryClient.invalidateQueries({ queryKey: queryKeys.config.all });
const refreshLibraries = async () =>
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.libraries.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.library.all }),
  ]);

const toolData = async <T>(input: Parameters<typeof api.tools.execute>[0]): Promise<T> =>
  (await api.tools.execute(input)).data as T;

const createWebBriefPort = (navigate: {
  workbenchReview: () => void;
  open: (destination: BriefDestination) => void;
}): BriefPort => ({
  plan: async (input) => await api.brief.plan(input),
  config: async () => {
    const config = await api.config.read();
    queryClient.setQueryData(queryKeys.config.current, config);
    return config;
  },
  libraries: async () => (await api.libraries.list()).libraries,
  setup: createWebSetupPort(),
  suggestDirectory: async (path) => {
    const result = await api.serverPaths.suggest({ path, intent: "workbench-output" });
    return {
      accessible: result.accessible,
      error: result.error,
      entries: result.entries.map((entry) => ({ label: entry.label, path: entry.path })),
    };
  },
  showLibraryAutomation: !desktop,
  pendingItems: async () => (await api.pending.list()).items,
  movies: async (filter) => {
    const entries: LibraryEntryDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.library.list({ ...filter, cursor, limit: 500 });
      entries.push(...page.entries);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return entries;
  },
  moviePage: async (filter, limit) => {
    const page = await api.library.list({ ...filter, limit });
    return { entries: page.entries, total: page.total };
  },
  posterSrc: (entry) =>
    getLibraryAssetSrc({
      format: "webp",
      path: entry.thumbnailPath,
      rootId: entry.thumbnailRootId ?? entry.fileRefs.find((file) => file.id === entry.displayFileId)?.rootId ?? "",
      width: 160,
    }),
  fileRef: async (path) => {
    const { directory, name } = splitHostPath(path);
    const root = await api.mediaRoots.ensurePath({ hostPath: directory });
    return { rootId: root.id, relativePath: root.relativeDirectory ? `${root.relativeDirectory}/${name}` : name };
  },
  startScrape: async (input) => {
    const { runId } = await api.scrape.start(input);
    requestScrapeLiveRunsRefresh();
    return runId;
  },
  startMaintenance: async (input) => (await api.maintenance.start(input)).sessionId,
  retryPending: async (input) => {
    const { taskId } = await api.pending.retry(input);
    requestScrapeLiveRunsRefresh();
    await refreshPendingQueries(queryClient);
    return taskId;
  },
  retryPendingMany: async (input) => {
    const { taskIds } = await api.pending.retryMany(input);
    requestScrapeLiveRunsRefresh();
    await refreshPendingQueries(queryClient);
    return taskIds;
  },
  confirmUncensored: async (input) => {
    await api.pending.confirmUncensored(input);
    await refreshPendingQueries(queryClient);
  },
  ignorePending: async (ids) => {
    await api.pending.ignore({ ids });
    await refreshPendingQueries(queryClient);
  },
  startEdit: async (input) => (await api.library.edit.start(input)).id,
  updateConfig: async (patch) => {
    const config = await api.config.update(patch);
    queryClient.setQueryData(queryKeys.config.current, config);
    await refreshConfig();
    return config;
  },
  createLibrary: async (settings) => {
    const library = await api.libraries.create(settings);
    await refreshLibraries();
    return library;
  },
  updateLibrary: async (id, settings) => {
    const library = await api.libraries.update({ id, settings });
    await refreshLibraries();
    return library;
  },
  previewNaming: async (settings) => (await api.libraries.previewNaming(settings)).items,
  previewPosterBadges: async (input) => (await api.app.previewPosterBadges(input)).imageDataUrl,
  ignoreHealth: async (input) => {
    await api.library.ignoreHealth(input);
    await refreshLibraries();
  },
  restoreIgnored: async (input) => {
    await api.library.restoreIgnored(input);
    await refreshLibraries();
  },
  profiles: async () => await api.config.profiles.list(),
  switchProfile: async (name) => {
    await api.config.profiles.switch({ name });
    await Promise.all([refreshConfig(), refreshLibraries()]);
  },
  createProfile: async (name) => {
    await api.config.profiles.create({ name });
    await refreshConfig();
  },
  checkMediaServer: async (server) =>
    await toolData<MediaServerConnectionCheckResult>({ toolId: "media-library-tools", server }),
  startPersonSync: async (input) => {
    const job = await api.tools.startPersonSync(input);
    queryClient.setQueryData(queryKeys.personSync, job);
    return job.id;
  },
  stopNameMatching: async () =>
    await toolData<MediaServerConnectionCheckResult>({
      toolId: "media-library-tools",
      server: "jellyfin",
      action: "stopPersonNameMatching",
    }),
  symlink: async (input) => await toolData<SymlinkResult>({ toolId: "symlink-manager", ...input }),
  probeSite: async (site) => await api.crawler.probeSiteConnectivity({ site }),
  checkCookies: async () => await api.network.checkCookies(),
  testTranslation: async (input) => await api.translate.test(input),
  testNotifications: async (settings) => {
    await api.notifications.test(settings);
  },
  crawlerTest: async (input) => {
    const result = await toolData<{ data: CrawlerTestResult["data"]; stats?: { totalElapsedMs: number } } | null>({
      toolId: "crawler-tester",
      ...input,
    });
    return { data: result?.data ?? null, elapsed: result?.stats?.totalElapsedMs ?? 0 };
  },
  scrapeSnapshot: async (taskId) => {
    try {
      return await api.scrape.snapshot({ taskId });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
  maintenanceSession: async () => await api.maintenance.getActiveSession(),
  editJob: async () => await api.library.edit.status(),
  personSyncJob: async () => await api.tools.personSyncStatus(),
  pauseScrape: async (taskId) => {
    await api.scrape.pause({ taskId });
    requestScrapeLiveRunsRefresh();
  },
  resumeScrape: async (taskId) => {
    await api.scrape.resume({ taskId });
    requestScrapeLiveRunsRefresh();
  },
  stopScrape: async (taskId) => {
    await api.scrape.stop({ taskId });
    requestScrapeLiveRunsRefresh();
  },
  retryScrape: async (taskId) => {
    const { runId } = await api.scrape.retry({ taskId });
    requestScrapeLiveRunsRefresh();
    return runId;
  },
  pauseMaintenance: async (sessionId) => {
    await api.maintenance.pause({ sessionId });
  },
  resumeMaintenance: async (sessionId) => {
    await api.maintenance.resume({ sessionId });
  },
  stopMaintenance: async (sessionId) => {
    await api.maintenance.stop({ sessionId });
  },
  openMaintenanceReview: navigate.workbenchReview,
  open: navigate.open,
});

/** One port per page that follows or plans jobs; its navigation goes through the router. */
export const useWebBriefPort = (): BriefPort => {
  const navigate = useNavigate();
  return useMemo(
    () =>
      createWebBriefPort({
        workbenchReview: () => void navigate({ to: "/workbench", search: { intent: "maintenance" } }),
        open: (destination) => {
          if (destination.page === "library") void navigate({ to: "/library", search: destination.search });
          else if (destination.page === "settings")
            void navigate({ to: buildHref("/settings", { section: destination.section }) });
          // A new `open` each time, so the same form opens again after the user went back to the catalogue.
          else
            void navigate({
              to: buildHref("/tools", {
                tool: destination.page === "amazonPoster" ? "amazon-poster" : "batch-nfo-translator",
                directory: destination.directory,
                mode: destination.page === "batchTranslate" ? destination.mode : undefined,
                open: String(Date.now()),
              }),
            });
        },
      }),
    [navigate],
  );
};
