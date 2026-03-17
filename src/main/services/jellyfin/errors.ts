import { toErrorMessage } from "@main/utils/common";

const HTTP_STATUS_PATTERN = /HTTP\s+(\d{3})\b/u;

export class JellyfinServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const getHttpStatus = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const matched = error.message.match(HTTP_STATUS_PATTERN);
  if (!matched) {
    return undefined;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const toJellyfinServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, { code: string; message: string }>>,
  fallback: { code: string; message: string },
): JellyfinServiceError => {
  if (error instanceof JellyfinServiceError) {
    return error;
  }

  const status = getHttpStatus(error);
  const mapped = status !== undefined ? statusMappings[status] : undefined;
  if (mapped) {
    return new JellyfinServiceError(mapped.code, mapped.message, status);
  }

  return new JellyfinServiceError(fallback.code, `${fallback.message}: ${toErrorMessage(error)}`, status);
};
