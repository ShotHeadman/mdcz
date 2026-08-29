import type { IpcActionContext } from "@mdcz/shared/ipcTypes";
import { ZodError, type ZodType } from "zod";
import { asSerializableIpcError } from "./errorHandling";
import { createIpcError, IpcErrorCode } from "./errors";
import { assertAllowedIpcSender } from "./senderOrigin";

export { asSerializableIpcError } from "./errorHandling";

const toSchemaIpcError = (error: unknown) => {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join("; ") || "Invalid IPC payload";
    return createIpcError(IpcErrorCode.INVALID_ARGUMENT, message);
  }
  return asSerializableIpcError(error);
};

const parseInput = <TInput>(schema: ZodType<TInput>, input: unknown): TInput => {
  try {
    return schema.parse(input);
  } catch (error) {
    throw toSchemaIpcError(error);
  }
};

export const t = {
  procedure: {
    input<TInput>(schema: ZodType<TInput>) {
      return {
        action<TResult>(action: (args: { context: IpcActionContext; input: TInput }) => Promise<TResult>) {
          return {
            action: async (args: { context: IpcActionContext; input: unknown }) => {
              assertAllowedIpcSender(args.context);
              return await action({ context: args.context, input: parseInput(schema, args.input) });
            },
          };
        },
      };
    },
    action<TResult>(action: (args: { context: IpcActionContext }) => Promise<TResult>) {
      return {
        action: async (args: { context: IpcActionContext; input?: unknown }) => {
          assertAllowedIpcSender(args.context);
          return await action({ context: args.context });
        },
      };
    },
  },
};
