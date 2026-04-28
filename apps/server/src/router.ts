import { initTRPC } from "@trpc/server";

import { createHealthPayload } from "./http";

const t = initTRPC.create();

export const appRouter = t.router({
  health: t.procedure.query(() => createHealthPayload()),
});

export type AppRouter = typeof appRouter;
