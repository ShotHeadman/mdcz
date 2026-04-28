/**
 * Centralized IPC error handling
 */

import { toErrorMessage } from "../utils/common.js";

export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const toStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

export class SerializableIpcError extends Error implements IpcError {
  readonly code: string;
  readonly details?: unknown;
  readonly fields?: string[];
  readonly fieldErrors?: Record<string, string>;

  constructor(error: IpcError) {
    super(error.message);
    this.name = error.code;
    this.code = error.code;
    this.details = error.details;

    if (isRecord(error.details)) {
      const fields = toStringArray(error.details.fields);
      if (fields.length > 0) {
        this.fields = fields;
      }

      const fieldErrors = toStringRecord(error.details.fieldErrors);
      if (fieldErrors) {
        this.fieldErrors = fieldErrors;
      }
    }
  }
}

/**
 * Creates a standardized IPC error object
 */
export function createIpcError(code: string, message: string, details?: unknown): SerializableIpcError {
  return new SerializableIpcError({
    code,
    message,
    ...(details !== undefined && { details }),
  });
}

/**
 * Converts an unknown error to a standardized IPC error
 */
export function toIpcError(error: unknown): IpcError {
  // Already an IPC error
  if (isIpcError(error)) {
    return error;
  }

  // Error with code property
  if (error instanceof Error && "code" in error) {
    return createIpcError(String((error as Error & { code: unknown }).code), error.message);
  }

  // Standard Error
  if (error instanceof Error) {
    return createIpcError(error.name || "ERROR", error.message);
  }

  // String error
  if (typeof error === "string") {
    return createIpcError("ERROR", error);
  }

  // Object with message
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message: unknown }).message;
    return createIpcError("ERROR", typeof msg === "string" ? msg : String(msg));
  }

  // Unknown error
  return createIpcError("UNKNOWN_ERROR", toErrorMessage(error));
}

export function toSerializableIpcError(error: unknown): SerializableIpcError {
  if (error instanceof SerializableIpcError) {
    return error;
  }
  return new SerializableIpcError(toIpcError(error));
}

/**
 * Type guard to check if a value is an IPC error
 */
export function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as IpcError).code === "string" &&
    typeof (value as IpcError).message === "string"
  );
}

/**
 * Common IPC error codes
 */
export const IpcErrorCode = {
  // Configuration errors
  CONFIG_VALIDATION_ERROR: "CONFIG_VALIDATION_ERROR",
  CONFIG_SAVE_ERROR: "CONFIG_SAVE_ERROR",

  // File system errors
  FILE_WRITE_ERROR: "FILE_WRITE_ERROR",
  DIRECTORY_NOT_FOUND: "DIRECTORY_NOT_FOUND",

  // Runtime errors
  NETWORK_ERROR: "NETWORK_ERROR",
  PARSE_ERROR: "PARSE_ERROR",

  // General errors
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  OPERATION_CANCELLED: "OPERATION_CANCELLED",
} as const;

export type IpcErrorCodeType = (typeof IpcErrorCode)[keyof typeof IpcErrorCode];
