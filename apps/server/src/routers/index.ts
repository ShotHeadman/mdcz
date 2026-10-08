import { MediaDirectoryUnavailableError, toMediaLibraryDto } from "@mdcz/runtime/library";
import {
  mediaLibraryIdInputSchema,
  mediaLibrarySettingsSchema,
  mediaLibraryUpdateInputSchema,
} from "@mdcz/shared/mediaLibrary";
import {
  pendingConfirmUncensoredInputSchema,
  pendingIdInputSchema,
  pendingRetryInputSchema,
} from "@mdcz/shared/pending";
import type { HealthResponse } from "@mdcz/shared/serverDtos";
import {
  activityListInputSchema,
  apiKeyCreateInputSchema,
  authLoginInputSchema,
  cancelCandidatesInputSchema,
  configImportInputSchema,
  configPathInputSchema,
  configProfileImportInputSchema,
  configProfileNameInputSchema,
  configUpdateInputSchema,
  crawlerProbeSiteConnectivityInputSchema,
  fileActionInputSchema,
  libraryAvailabilityInputSchema,
  libraryDetailInputSchema,
  libraryFileRemoveInputSchema,
  libraryListInputSchema,
  libraryRelinkInputSchema,
  librarySummaryInputSchema,
  logListInputSchema,
  maintenanceApplyInputSchema,
  maintenanceDiscardSessionInputSchema,
  maintenanceSessionInputSchema,
  maintenanceStartInputSchema,
  maintenanceUpdateDraftInputSchema,
  mediaRootEnsurePathInputSchema,
  nfoReadInputSchema,
  nfoWriteInputSchema,
  posterCropSaveInputSchema,
  rootBrowserInputSchema,
  scanCandidatesInputSchema,
  scanStartInputSchema,
  scanTaskIdInputSchema,
  scrapeRerunDirectoryInputSchema,
  scrapeResultIdInputSchema,
  scrapeStartInputSchema,
  scrapeTaskControlInputSchema,
  serverPathSuggestInputSchema,
  setupCompleteInputSchema,
  toolExecuteInputSchema,
  translateTestInputSchema,
} from "@mdcz/shared/serverDtos";
import { TRPCError } from "@trpc/server";
import { createHealthPayload } from "../http/health";
import { decorateTaskLog } from "../services/runtimeLogService";
import { mapConfigError, protectedProcedure, setupProcedure, t } from "./context";

const scrapeLaunchProcedure = protectedProcedure;

export const appRouter = t.router({
  auth: t.router({
    setup: t.procedure.query(async ({ ctx }) => {
      return await ctx.services.auth.status();
    }),
    login: t.procedure
      .input(authLoginInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.auth.login(input.password)),
    logout: t.procedure.mutation(async ({ ctx }) => await ctx.services.auth.logout(ctx.token)),
    status: t.procedure.query(async ({ ctx }) => {
      return await ctx.services.auth.status(ctx.token);
    }),
  }),
  app: t.router({
    ensureWatermarkDirectory: protectedProcedure.mutation(
      async ({ ctx }) => await ctx.services.runtimeActions.ensureWatermarkDirectory(),
    ),
  }),
  browser: t.router({
    list: protectedProcedure
      .input(rootBrowserInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.browser.list(input)),
  }),
  serverPaths: t.router({
    suggest: protectedProcedure
      .input(serverPathSuggestInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.serverPaths.suggest(input)),
  }),
  crawler: t.router({
    listSites: protectedProcedure.query(async ({ ctx }) => await ctx.services.runtimeActions.listCrawlerSites()),
    probeSiteConnectivity: protectedProcedure
      .input(crawlerProbeSiteConnectivityInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.runtimeActions.probeSiteConnectivity(input)),
  }),
  network: t.router({
    checkCookies: protectedProcedure.mutation(async ({ ctx }) => await ctx.services.runtimeActions.checkCookies()),
  }),
  translate: t.router({
    test: protectedProcedure
      .input(translateTestInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.runtimeActions.testTranslation(input)),
  }),
  config: t.router({
    defaults: protectedProcedure.query(({ ctx }) => ctx.services.config.defaults()),
    export: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.export()),
    read: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.get()),
    import: protectedProcedure.input(configImportInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.import(input.content);
      } catch (error) {
        return mapConfigError(error);
      }
    }),
    reset: protectedProcedure
      .input(configPathInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.config.reset(input?.path)),
    update: protectedProcedure.input(configUpdateInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.update(input);
      } catch (error) {
        return mapConfigError(error);
      }
    }),
    profiles: t.router({
      list: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.listProfiles()),
      create: protectedProcedure
        .input(configProfileNameInputSchema)
        .mutation(async ({ ctx, input }) => await ctx.services.config.createProfile(input.name)),
      switch: protectedProcedure
        .input(configProfileNameInputSchema)
        .mutation(async ({ ctx, input }) => await ctx.services.config.switchProfile(input.name)),
      delete: protectedProcedure
        .input(configProfileNameInputSchema)
        .mutation(async ({ ctx, input }) => await ctx.services.config.deleteProfile(input.name)),
      export: protectedProcedure
        .input(configProfileNameInputSchema)
        .mutation(async ({ ctx, input }) => await ctx.services.config.exportProfile(input.name)),
      import: protectedProcedure.input(configProfileImportInputSchema).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.services.config.importProfile(input);
        } catch (error) {
          return mapConfigError(error);
        }
      }),
    }),
  }),
  health: t.router({
    read: t.procedure.query((): HealthResponse => createHealthPayload()),
  }),
  system: t.router({
    about: protectedProcedure.query(async ({ ctx }) => await ctx.services.system.about()),
  }),
  logs: t.router({
    list: protectedProcedure.input(logListInputSchema).query(async ({ ctx, input }) => {
      const kind = input?.kind ?? "all";
      if (kind === "runtime") {
        return ctx.services.runtimeLogs.list(input);
      }
      const scanLogs = await ctx.services.scans.logs();
      const taskIdFilter = new Set(input?.taskIds ?? []);
      const taskLogsClearedAt = ctx.services.runtimeLogs.getTaskLogsClearedAt();
      const taskLogs = scanLogs.logs
        .map(decorateTaskLog)
        .filter((log) => taskIdFilter.size === 0 || taskIdFilter.has(log.taskId))
        .filter((log) => !taskLogsClearedAt || log.createdAt > taskLogsClearedAt);
      const runtimeLogs = kind === "task" ? [] : ctx.services.runtimeLogs.list(input).logs;
      return {
        logs: [...taskLogs, ...runtimeLogs].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      };
    }),
    clearRuntime: protectedProcedure.mutation(({ ctx }) => {
      const cleared = ctx.services.runtimeLogs.clear();
      ctx.services.runtimeLogs.clearTaskLogs();
      return {
        ok: true as const,
        cleared,
      };
    }),
  }),
  activity: t.router({
    list: protectedProcedure
      .input(activityListInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.activity.list(input?.limit)),
  }),
  library: t.router({
    removeFile: protectedProcedure
      .input(libraryFileRemoveInputSchema)
      .mutation(async ({ ctx, input }) => ctx.services.library.removeFile(input)),
    availability: protectedProcedure
      .input(libraryAvailabilityInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.availability(input)),
    list: protectedProcedure
      .input(libraryListInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.list(input)),
    summary: protectedProcedure
      .input(librarySummaryInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.summary(input)),
    detail: protectedProcedure
      .input(libraryDetailInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.detail(input.id)),
    refresh: protectedProcedure
      .input(libraryDetailInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.refresh(input.id)),
    relink: protectedProcedure
      .input(libraryRelinkInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.relink(input)),
    delete: protectedProcedure
      .input(libraryDetailInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.deleteEntry(input.id)),
    rescan: protectedProcedure.input(libraryDetailInputSchema).mutation(async ({ ctx, input }) => {
      const detail = await ctx.services.library.detail(input.id);
      const file = detail.entry.fileRefs.find((file) => file.id === detail.entry.displayFileId);
      if (!file) throw new Error("Movie has no display file");
      return await ctx.services.scans.start(file.rootId);
    }),
  }),
  overview: t.router({
    summary: protectedProcedure.query(async ({ ctx }) => await ctx.services.library.overview()),
    removeRecentAcquisition: protectedProcedure
      .input(libraryDetailInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.removeRecentAcquisition(input.id)),
  }),
  tools: t.router({
    catalog: protectedProcedure.query(({ ctx }) => ctx.services.tools.catalog()),
    execute: protectedProcedure
      .input(toolExecuteInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.tools.execute(input)),
  }),
  libraries: t.router({
    list: protectedProcedure.query(async ({ ctx }) => ({
      libraries: (await ctx.services.libraries.list()).map(toMediaLibraryDto),
    })),
    create: protectedProcedure.input(mediaLibrarySettingsSchema).mutation(async ({ ctx, input }) => {
      const library = toMediaLibraryDto(await ctx.services.libraries.create(input));
      await ctx.services.libraryWatch.refresh();
      return library;
    }),
    update: protectedProcedure.input(mediaLibraryUpdateInputSchema).mutation(async ({ ctx, input }) => {
      const library = toMediaLibraryDto(await ctx.services.libraries.update(input.id, input.settings));
      await ctx.services.libraryWatch.refresh();
      return library;
    }),
    delete: protectedProcedure.input(mediaLibraryIdInputSchema).mutation(async ({ ctx, input }) => {
      await ctx.services.libraries.delete(input.id);
      await ctx.services.libraryWatch.refresh();
      return { success: true as const };
    }),
    previewNaming: protectedProcedure
      .input(mediaLibrarySettingsSchema)
      .mutation(async ({ ctx, input }) => ({ items: await ctx.services.libraries.previewNaming(input) })),
  }),
  pending: t.router({
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.pending.list()),
    detail: protectedProcedure
      .input(pendingIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.pending.detail(input.id)),
    retry: protectedProcedure
      .input(pendingRetryInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.pending.retry(input)),
    confirmUncensored: protectedProcedure
      .input(pendingConfirmUncensoredInputSchema)
      .mutation(async ({ ctx, input }) => {
        await ctx.services.pending.confirmUncensored(input);
        return { success: true as const };
      }),
    ignore: protectedProcedure.input(pendingIdInputSchema).mutation(async ({ ctx, input }) => {
      await ctx.services.pending.ignore(input.id);
      return { success: true as const };
    }),
  }),
  apiKeys: t.router({
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.auth.listApiKeys()),
    create: protectedProcedure
      .input(apiKeyCreateInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.auth.createApiKey(input)),
    delete: protectedProcedure.input(pendingIdInputSchema).mutation(async ({ ctx, input }) => {
      await ctx.services.auth.deleteApiKey(input.id);
      return { success: true as const };
    }),
  }),
  notifications: t.router({
    test: protectedProcedure.mutation(async ({ ctx }) => {
      await ctx.services.automation.testNotification();
      return { success: true as const };
    }),
  }),
  mediaRoots: t.router({
    ensurePath: protectedProcedure
      .input(mediaRootEnsurePathInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.ensurePath(input)),
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.mediaRoots.list()),
  }),
  maintenance: t.router({
    execute: protectedProcedure
      .input(maintenanceApplyInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.execute(input)),
    pause: protectedProcedure
      .input(maintenanceSessionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.pause(input)),
    getActiveSession: protectedProcedure.query(async ({ ctx }) => await ctx.services.maintenance.getActiveSession()),
    updateDraft: protectedProcedure
      .input(maintenanceUpdateDraftInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.updateDraft(input)),
    discardSession: protectedProcedure
      .input(maintenanceDiscardSessionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.discardSession(input)),
    resume: protectedProcedure
      .input(maintenanceSessionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.resume(input)),
    start: protectedProcedure.input(maintenanceStartInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.maintenance.start(input);
      } catch (error) {
        if (error instanceof MediaDirectoryUnavailableError)
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        throw error;
      }
    }),
    stop: protectedProcedure
      .input(maintenanceSessionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.stop(input)),
  }),
  persistence: t.router({
    status: protectedProcedure.query(async ({ ctx }) => ({
      ok: ctx.services.persistence.initialized,
      path: ctx.services.persistence.databasePath,
    })),
  }),
  scans: t.router({
    cancelCandidates: protectedProcedure.input(cancelCandidatesInputSchema).mutation(async ({ ctx, input }) => {
      await ctx.services.scans.cancelCandidates(input.scanId);
      return { ok: true as const };
    }),
    candidates: protectedProcedure
      .input(scanCandidatesInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scans.candidates(input)),
    detail: protectedProcedure
      .input(scanTaskIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scans.detail(input.taskId)),
    events: protectedProcedure
      .input(scanTaskIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scans.events(input.taskId)),
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.scans.list()),
    retry: protectedProcedure
      .input(scanTaskIdInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scans.retry(input.taskId)),
    start: protectedProcedure
      .input(scanStartInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scans.start(input.rootId)),
  }),
  scrape: t.router({
    removeRecord: protectedProcedure
      .input(fileActionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.removeRecord(input)),
    history: protectedProcedure
      .input(scrapeTaskControlInputSchema.optional())
      .query(async ({ ctx, input }) => await ctx.services.scrape.history(input)),
    liveRuns: protectedProcedure.query(async ({ ctx }) => await ctx.services.scrape.liveRuns()),
    snapshot: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.snapshot(input)),
    nfoRead: protectedProcedure
      .input(nfoReadInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.nfoRead(input)),
    nfoWrite: protectedProcedure
      .input(nfoWriteInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.nfoWrite(input)),
    posterCropSession: protectedProcedure
      .input(scrapeResultIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.posterCropSession(input.id)),
    posterCropSave: protectedProcedure
      .input(posterCropSaveInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.posterCropSave(input)),
    pause: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => ({ runId: await ctx.services.scrape.pause(input) })),
    result: protectedProcedure
      .input(scrapeResultIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.result(input.id)),
    resume: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => ({ runId: await ctx.services.scrape.resume(input) })),
    retry: scrapeLaunchProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => ({ runId: (await ctx.services.scrape.retry(input)).task.id })),
    rerunDirectory: scrapeLaunchProcedure
      .input(scrapeRerunDirectoryInputSchema)
      .mutation(async ({ ctx, input }) => ({ runId: (await ctx.services.scrape.rerunDirectory(input)).task.id })),
    start: scrapeLaunchProcedure.input(scrapeStartInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return { runId: (await ctx.services.scrape.start(input)).task.id };
      } catch (error) {
        if (error instanceof MediaDirectoryUnavailableError)
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        throw error;
      }
    }),
    stop: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => ({ runId: await ctx.services.scrape.stop(input) })),
  }),
  setup: t.router({
    complete: setupProcedure.input(setupCompleteInputSchema).mutation(async ({ ctx, input }) => {
      return await ctx.services.auth.completeSetup(input);
    }),
    status: t.procedure.query(async ({ ctx }) => {
      const mediaRootStatus = await ctx.services.mediaRoots.setupStatus();
      const authStatus = await ctx.services.auth.status(ctx.token);
      return {
        configured: !authStatus.setupRequired,
        setupRequired: Boolean(authStatus.setupRequired),
        mediaRootCount: mediaRootStatus.mediaRootCount,
        environmentPasswordConfigured: Boolean(authStatus.environmentPasswordConfigured),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
