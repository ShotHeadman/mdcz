import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@mdcz/shared/error";
import { isIpcError, SerializableIpcError, toSerializableIpcError } from "./errors";

const logger = loggerService.getLogger("IpcRouter");

interface IpcErrorLogger {
  error(message: string): void;
}

interface WithIpcErrorHandlingOptions {
  mapError?: (error: unknown) => SerializableIpcError | undefined;
  logger?: IpcErrorLogger;
}

export const asSerializableIpcError = (error: unknown): SerializableIpcError => {
  if (error instanceof SerializableIpcError) {
    return error;
  }
  return toSerializableIpcError(error);
};

export const withIpcErrorHandling = async <T>(
  handlerName: string,
  fn: () => T | Promise<T>,
  options: WithIpcErrorHandlingOptions = {},
): Promise<Awaited<T>> => {
  try {
    return await fn();
  } catch (error) {
    const mappedError = options.mapError?.(error);
    if (mappedError) {
      throw mappedError;
    }

    if (error instanceof SerializableIpcError || isIpcError(error)) {
      throw asSerializableIpcError(error);
    }

    (options.logger ?? logger).error(`Failed to ${handlerName}: ${toErrorMessage(error)}`);
    throw asSerializableIpcError(error);
  }
};
