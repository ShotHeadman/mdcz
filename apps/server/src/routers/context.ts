import { LibraryTaskConflictError } from "@mdcz/runtime/tasks";
import {
  DomainErrorCode,
  type DomainErrorShape,
  formatValidationError,
  type LibraryTaskConflictDomainError,
  NotFoundError,
} from "@mdcz/shared/error";
import { initTRPC, TRPCError } from "@trpc/server";
import type { ServerServices } from "../services";
import { isApiKey } from "../services/authService";
import { ServerConfigValidationError } from "../services/configService";

export interface RouterContext {
  services: ServerServices;
  token?: string;
  clientAddress?: string;
}

export const t = initTRPC.context<RouterContext>().create({
  // A build run without NODE_ENV must not send stack traces to clients.
  isDev: process.env.NODE_ENV === "development",
  errorFormatter: ({ shape, error }) => {
    let domainError: DomainErrorShape | undefined;
    if (error.cause instanceof ServerConfigValidationError) domainError = error.cause.domainError;
    if (error.cause instanceof LibraryTaskConflictError) {
      domainError = {
        code: DomainErrorCode.LIBRARY_TASK_CONFLICT,
        message: error.cause.message,
        details: { running: error.cause.running },
      } satisfies LibraryTaskConflictDomainError;
    }
    // Input validation fails with the schema's issue list as JSON; people read the issues.
    const message = (error.code === "BAD_REQUEST" && formatValidationError(error.cause)) || shape.message;
    return { ...shape, message, data: { ...shape.data, domainError } };
  },
});

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  try {
    await ctx.services.auth.assertAuthenticated(ctx.token);
  } catch (error) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: error instanceof Error ? error.message : "Authentication required",
    });
  }
  const result = await next({ ctx });
  const cause = result.ok ? undefined : result.error.cause;
  if (cause instanceof NotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: cause.message, cause });
  if (cause instanceof LibraryTaskConflictError)
    throw new TRPCError({ code: "CONFLICT", message: cause.message, cause });
  return result;
});

// A key that could mint keys or change the password would keep its holder in after the key is revoked.
export const sessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (isApiKey(ctx.token)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "API keys cannot manage API keys or the password" });
  }
  return next({ ctx });
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
      message: "Setup is already complete; please sign in",
    });
  }
  return next({ ctx });
});
