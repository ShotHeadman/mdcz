import { initTRPC, TRPCError } from "@trpc/server";
import type { ServerServices } from "../services";
import { ServerConfigValidationError } from "../services/configService";

export interface RouterContext {
  services: ServerServices;
  token?: string;
}

export const t = initTRPC.context<RouterContext>().create();

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
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

export const mapConfigError = (error: unknown): never => {
  if (error instanceof ServerConfigValidationError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
};

export const setupProcedure = t.procedure.use(async ({ ctx, next }) => {
  const authStatus = await ctx.services.auth.status(ctx.token);
  if (!authStatus.setupRequired) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "系统已完成初始化，请直接登录",
    });
  }
  return next({ ctx });
});
