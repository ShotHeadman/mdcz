import { initTRPC } from "@trpc/server";

import { createHealthPayload } from "./http";
import type { ServerServices } from "./services";

interface RouterContext {
  services: ServerServices;
}

const t = initTRPC.context<RouterContext>().create();

export const appRouter = t.router({
  config: t.router({
    export: t.procedure.query(async ({ ctx }) => await ctx.services.config.export()),
    read: t.procedure.query(async ({ ctx }) => await ctx.services.config.get()),
  }),
  health: t.procedure.query(() => createHealthPayload()),
});

export type AppRouter = typeof appRouter;
