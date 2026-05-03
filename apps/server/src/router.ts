import {
  authLoginInputSchema,
  configImportInputSchema,
  configPathInputSchema,
  configPreviewInputSchema,
  configProfileImportInputSchema,
  configProfileNameInputSchema,
  configUpdateInputSchema,
  fileActionInputSchema,
  libraryDetailInputSchema,
  libraryListInputSchema,
  libraryRelinkInputSchema,
  logListInputSchema,
  maintenanceApplyInputSchema,
  maintenanceStartInputSchema,
  maintenanceTaskInputSchema,
  mediaRootCreateInputSchema,
  mediaRootIdInputSchema,
  mediaRootUpdateInputSchema,
  nfoReadInputSchema,
  nfoWriteInputSchema,
  rootBrowserInputSchema,
  scanStartInputSchema,
  scanTaskIdInputSchema,
  scrapeResultIdInputSchema,
  scrapeStartInputSchema,
  scrapeTaskControlInputSchema,
  setupCompleteInputSchema,
  toolExecuteInputSchema,
} from "@mdcz/shared/serverDtos";
import { initTRPC, TRPCError } from "@trpc/server";

import { ServerConfigValidationError } from "./configService";
import { createHealthPayload } from "./http";
import { decorateTaskLog } from "./runtimeLogService";
import type { ServerServices } from "./services";

interface RouterContext {
  services: ServerServices;
  token?: string;
}

const t = initTRPC.context<RouterContext>().create();

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  try {
    ctx.services.auth.assertAuthenticated(ctx.token);
    return next({ ctx });
  } catch (error) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: error instanceof Error ? error.message : "Authentication required",
    });
  }
});

const mapConfigError = (error: unknown): never => {
  if (error instanceof ServerConfigValidationError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
};

const setupProcedure = t.procedure.use(async ({ ctx, next }) => {
  const setupStatus = await ctx.services.mediaRoots.setupStatus();
  const authStatus = await ctx.services.auth.status(ctx.token, setupStatus.mediaRootCount);
  if (!authStatus.setupRequired) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "初始化已完成",
    });
  }
  return next({ ctx });
});

export const appRouter = t.router({
  auth: t.router({
    setup: t.procedure.query(async ({ ctx }) => {
      const setupStatus = await ctx.services.mediaRoots.setupStatus();
      return await ctx.services.auth.setup(setupStatus.mediaRootCount);
    }),
    login: t.procedure
      .input(authLoginInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.auth.login(input.password)),
    logout: t.procedure.mutation(({ ctx }) => ctx.services.auth.logout(ctx.token)),
    status: t.procedure.query(async ({ ctx }) => {
      const setupStatus = await ctx.services.mediaRoots.setupStatus();
      return await ctx.services.auth.status(ctx.token, setupStatus.mediaRootCount);
    }),
  }),
  browser: t.router({
    list: protectedProcedure
      .input(rootBrowserInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.browser.list(input)),
  }),
  config: t.router({
    defaults: protectedProcedure.query(({ ctx }) => ctx.services.config.defaults()),
    export: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.export()),
    read: protectedProcedure.input(configPathInputSchema).query(async ({ ctx, input }) => {
      if (input?.path) {
        return await ctx.services.config.get(input.path);
      }
      return await ctx.services.config.get();
    }),
    import: protectedProcedure.input(configImportInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.import(input.content);
      } catch (error) {
        mapConfigError(error);
      }
    }),
    previewNaming: protectedProcedure.input(configPreviewInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.previewNaming(input);
      } catch (error) {
        mapConfigError(error);
      }
    }),
    reset: protectedProcedure
      .input(configPathInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.config.reset(input?.path)),
    update: protectedProcedure.input(configUpdateInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.update(input);
      } catch (error) {
        mapConfigError(error);
      }
    }),
    save: protectedProcedure.input(configUpdateInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.config.update(input);
      } catch (error) {
        mapConfigError(error);
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
          mapConfigError(error);
        }
      }),
    }),
  }),
  health: t.router({
    read: t.procedure.query(() => createHealthPayload()),
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
      const [scanLogs, scrapeLogs, maintenanceLogs] = await Promise.all([
        ctx.services.scans.logs(),
        ctx.services.scrape.logs(),
        ctx.services.maintenance.logs(),
      ]);
      const taskLogs = [...scanLogs.logs, ...scrapeLogs.logs, ...maintenanceLogs.logs].map(decorateTaskLog);
      const runtimeLogs = kind === "task" ? [] : ctx.services.runtimeLogs.list(input).logs;
      return {
        logs: [...taskLogs, ...runtimeLogs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      };
    }),
    clearRuntime: protectedProcedure.mutation(({ ctx }) => ({
      ok: true as const,
      cleared: ctx.services.runtimeLogs.clear(),
    })),
  }),
  library: t.router({
    list: protectedProcedure
      .input(libraryListInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.list(input)),
    search: protectedProcedure
      .input(libraryListInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.search(input)),
    detail: protectedProcedure
      .input(libraryDetailInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.library.detail(input.id)),
    refresh: protectedProcedure
      .input(libraryDetailInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.refresh(input.id)),
    relink: protectedProcedure
      .input(libraryRelinkInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.library.relink(input)),
    rescan: protectedProcedure.input(libraryDetailInputSchema).mutation(async ({ ctx, input }) => {
      const detail = await ctx.services.library.detail(input.id);
      return await ctx.services.scans.start(detail.entry.rootId);
    }),
  }),
  overview: t.router({
    summary: protectedProcedure.query(async ({ ctx }) => await ctx.services.library.overview()),
  }),
  diagnostics: t.router({
    summary: protectedProcedure.query(async ({ ctx }) => await ctx.services.diagnostics.summary()),
  }),
  tools: t.router({
    catalog: protectedProcedure.query(({ ctx }) => ctx.services.tools.catalog()),
    execute: protectedProcedure
      .input(toolExecuteInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.tools.execute(input)),
  }),
  mediaRoots: t.router({
    availability: protectedProcedure
      .input(mediaRootIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.mediaRoots.availability(input.id)),
    create: protectedProcedure
      .input(mediaRootCreateInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.create(input)),
    delete: protectedProcedure
      .input(mediaRootIdInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.softDelete(input.id)),
    disable: protectedProcedure
      .input(mediaRootIdInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.disable(input.id)),
    enable: protectedProcedure
      .input(mediaRootIdInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.enable(input.id)),
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.mediaRoots.list()),
    update: protectedProcedure
      .input(mediaRootUpdateInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.mediaRoots.update(input)),
  }),
  maintenance: t.router({
    execute: protectedProcedure
      .input(maintenanceApplyInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.apply(input)),
    pause: protectedProcedure
      .input(maintenanceTaskInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.pause(input)),
    preview: protectedProcedure
      .input(maintenanceTaskInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.maintenance.preview(input)),
    recover: protectedProcedure.query(async ({ ctx }) => await ctx.services.maintenance.list()),
    resume: protectedProcedure
      .input(maintenanceTaskInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.resume(input)),
    start: protectedProcedure
      .input(maintenanceStartInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.start(input)),
    stop: protectedProcedure
      .input(maintenanceTaskInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.maintenance.stop(input)),
  }),
  persistence: t.router({
    status: protectedProcedure.query(async ({ ctx }) => ({
      ok: ctx.services.persistence.initialized,
      path: ctx.services.persistence.databasePath,
    })),
  }),
  scans: t.router({
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
    deleteFile: protectedProcedure
      .input(fileActionInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.deleteFile(input)),
    listResults: protectedProcedure
      .input(scrapeTaskControlInputSchema.optional())
      .query(async ({ ctx, input }) => await ctx.services.scrape.listResults(input)),
    nfoRead: protectedProcedure
      .input(nfoReadInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.nfoRead(input)),
    nfoWrite: protectedProcedure
      .input(nfoWriteInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.nfoWrite(input)),
    pause: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.pause(input)),
    result: protectedProcedure
      .input(scrapeResultIdInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.scrape.result(input.id)),
    resume: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.resume(input)),
    retry: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.retry(input)),
    start: protectedProcedure
      .input(scrapeStartInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.start(input)),
    stop: protectedProcedure
      .input(scrapeTaskControlInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scrape.stop(input)),
  }),
  tasks: t.router({
    detail: protectedProcedure.input(scanTaskIdInputSchema).query(async ({ ctx, input }) => {
      const scanDetail = await ctx.services.scans.detail(input.taskId).catch(() => null);
      const scrapeDetail = scanDetail ?? (await ctx.services.scrape.detail(input.taskId).catch(() => null));
      return scrapeDetail ?? (await ctx.services.maintenance.detail(input.taskId));
    }),
    events: protectedProcedure.input(scanTaskIdInputSchema).query(async ({ ctx, input }) => {
      const scanEvents = await ctx.services.scans.events(input.taskId).catch(() => null);
      const scrapeEvents = scanEvents ?? (await ctx.services.scrape.events(input.taskId).catch(() => null));
      return scrapeEvents ?? (await ctx.services.maintenance.events(input.taskId));
    }),
    list: protectedProcedure.query(async ({ ctx }) => {
      const [scans, scrape, maintenance] = await Promise.all([
        ctx.services.scans.list(),
        ctx.services.scrape.list(),
        ctx.services.maintenance.list(),
      ]);
      return {
        tasks: [...scans.tasks, ...scrape.tasks, ...maintenance.tasks].sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        ),
      };
    }),
    retry: protectedProcedure.input(scanTaskIdInputSchema).mutation(async ({ ctx, input }) => {
      const detail = await ctx.services.scans.detail(input.taskId).catch(() => null);
      if (detail?.task.kind === "scan") {
        return await ctx.services.scans.retry(input.taskId);
      }
      const scrapeDetail = await ctx.services.scrape.detail(input.taskId).catch(() => null);
      if (scrapeDetail?.task.kind === "scrape") {
        return await ctx.services.scrape.retry(input);
      }
      return await ctx.services.maintenance.start({
        rootId: (await ctx.services.maintenance.detail(input.taskId)).task.rootId,
        presetId: "read_local",
      });
    }),
  }),
  setup: t.router({
    complete: setupProcedure.input(setupCompleteInputSchema).mutation(async ({ ctx, input }) => {
      await ctx.services.mediaRoots.create(input.mediaRoot);
      return await ctx.services.auth.completeSetup(input.password);
    }),
    status: t.procedure.query(async ({ ctx }) => {
      const mediaRootStatus = await ctx.services.mediaRoots.setupStatus();
      const authStatus = await ctx.services.auth.status(ctx.token, mediaRootStatus.mediaRootCount);
      return {
        configured: !authStatus.setupRequired,
        setupRequired: Boolean(authStatus.setupRequired),
        mediaRootCount: mediaRootStatus.mediaRootCount,
        usingDefaultPassword: Boolean(authStatus.usingDefaultPassword),
        environmentPassword: authStatus.environmentPassword,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
