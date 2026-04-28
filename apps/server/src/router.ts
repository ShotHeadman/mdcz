import {
  authLoginInputSchema,
  mediaRootCreateInputSchema,
  mediaRootIdInputSchema,
  mediaRootUpdateInputSchema,
  rootBrowserInputSchema,
  scanStartInputSchema,
} from "@mdcz/shared/serverDtos";
import { initTRPC, TRPCError } from "@trpc/server";

import { createHealthPayload } from "./http";
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

export const appRouter = t.router({
  auth: t.router({
    login: t.procedure
      .input(authLoginInputSchema)
      .mutation(({ ctx, input }) => ctx.services.auth.login(input.password)),
    logout: t.procedure.mutation(({ ctx }) => ctx.services.auth.logout(ctx.token)),
    status: t.procedure.query(({ ctx }) => ctx.services.auth.status(ctx.token)),
  }),
  browser: t.router({
    list: protectedProcedure
      .input(rootBrowserInputSchema)
      .query(async ({ ctx, input }) => await ctx.services.browser.list(input)),
  }),
  config: t.router({
    export: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.export()),
    read: protectedProcedure.query(async ({ ctx }) => await ctx.services.config.get()),
  }),
  health: t.router({
    read: t.procedure.query(() => createHealthPayload()),
  }),
  mediaRoots: t.router({
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
  persistence: t.router({
    status: protectedProcedure.query(async ({ ctx }) => ({
      ok: ctx.services.persistence.initialized,
      path: ctx.services.persistence.databasePath,
    })),
  }),
  scans: t.router({
    events: protectedProcedure
      .input(mediaRootIdInputSchema.extend({ taskId: mediaRootIdInputSchema.shape.id }).omit({ id: true }))
      .query(async ({ ctx, input }) => await ctx.services.scans.events(input.taskId)),
    list: protectedProcedure.query(async ({ ctx }) => await ctx.services.scans.list()),
    start: protectedProcedure
      .input(scanStartInputSchema)
      .mutation(async ({ ctx, input }) => await ctx.services.scans.start(input.rootId)),
  }),
  setup: t.router({
    status: t.procedure.query(async ({ ctx }) => await ctx.services.mediaRoots.setupStatus()),
  }),
});

export type AppRouter = typeof appRouter;
