const normalizeWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();
const stripImpitPrefix = (value: string): string => value.replace(/^impit error:\s*/iu, "").trim();
const ELECTRON_REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']+':\s*/u;
const CONFIG_VALIDATION_ERROR_PREFIX = /^CONFIG_VALIDATION_ERROR:\s*/u;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isMissingMessage = (value: string): boolean =>
  value.trim().length === 0 || value === "null" || value === "undefined";

const extractLastMatch = (value: string, pattern: RegExp): string | undefined => {
  const matches = Array.from(value.matchAll(pattern));
  return matches.at(-1)?.[1];
};

const summarizeImpitError = (message: string): string | null => {
  const flattened = normalizeWhitespace(message);
  const normalized = stripImpitPrefix(flattened);
  const nestedError = extractLastMatch(normalized, /\berror:\s*"([^"]+)"/giu);
  const osMessage = extractLastMatch(normalized, /\bmessage:\s*"([^"]+)"/giu);
  const detail = nestedError ?? osMessage;

  if (/^(?:ConnectError:\s*)?Failed to connect to the server\.?/iu.test(normalized)) {
    return detail ? `ConnectError: ${detail}` : "ConnectError: failed to connect to the server";
  }

  if (/^impit error:/iu.test(flattened)) {
    return normalized;
  }

  return null;
};

/** A record, session or profile the caller named does not exist; the API answers 404. */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

export const DomainErrorCode = {
  CONFIG_VALIDATION: "CONFIG_VALIDATION",
  LIBRARY_TASK_CONFLICT: "LIBRARY_TASK_CONFLICT",
} as const;

export type DomainErrorCodeType = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

export interface DomainErrorShape<TDetails extends Record<string, unknown> = Record<string, unknown>> {
  code: DomainErrorCodeType;
  message: string;
  details?: TDetails;
}

export interface ConfigValidationDomainErrorDetails extends Record<string, unknown> {
  fields: string[];
  fieldErrors?: Record<string, string>;
}

export type ConfigValidationDomainError = DomainErrorShape<ConfigValidationDomainErrorDetails> & {
  code: typeof DomainErrorCode.CONFIG_VALIDATION;
};

/** Names the task kind already running, so the client can say what to stop. */
export interface LibraryTaskConflictDomainError extends DomainErrorShape {
  code: typeof DomainErrorCode.LIBRARY_TASK_CONFLICT;
  details: { running: "scrape" | "maintenance" | "edit" };
}

export const toConfigValidationDomainError = (input: {
  message: string;
  fields: string[];
  fieldErrors?: Record<string, string>;
}): ConfigValidationDomainError => ({
  code: DomainErrorCode.CONFIG_VALIDATION,
  message: input.message,
  details: {
    fields: input.fields,
    fieldErrors: input.fieldErrors,
  },
});

type ValidationIssue = { path: PropertyKey[]; message: string; errors?: ValidationIssue[][] };

const describeValidationIssues = (issues: readonly ValidationIssue[], prefix: PropertyKey[] = []): string[] =>
  issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    // A union reports each alternative's issues; the alternative with the fewest is the one the input meant.
    const closest = issue.errors?.toSorted((left, right) => left.length - right.length)[0];
    if (closest?.length) return describeValidationIssues(closest, path);
    return [path.length ? `${path.map(String).join(".")}: ${issue.message}` : issue.message];
  });

/** A schema validation error as people read it, when `error` is one; its own message is the issues as JSON. */
export const formatValidationError = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.name !== "ZodError" || !("issues" in error) || !Array.isArray(error.issues))
    return undefined;
  return describeValidationIssues(error.issues as ValidationIssue[]).join("; ");
};

export function formatErrorMessage(message: string): string {
  const normalized = normalizeWhitespace(message)
    .replace(ELECTRON_REMOTE_METHOD_PREFIX, "")
    .replace(CONFIG_VALIDATION_ERROR_PREFIX, "")
    .trim();
  const summarizedImpitError = summarizeImpitError(normalized);
  if (summarizedImpitError) {
    return summarizedImpitError;
  }

  return normalized;
}

export function toErrorMessage(error: unknown, fallbackMessage?: string): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (isRecord(error) && typeof error.message === "string") {
    message = error.message;
  } else {
    message = String(error);
  }

  const formatted = formatErrorMessage(message);
  return fallbackMessage && isMissingMessage(formatted) ? fallbackMessage : formatted;
}
