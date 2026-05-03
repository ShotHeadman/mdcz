import { toErrorMessage } from "../shared";

const HTTP_STATUS_PATTERN = /HTTP\s+(\d{3})\b/u;

export class MediaServerServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface MediaServerErrorMapping {
  code: string;
  message: string;
}

type MediaServerErrorClass<TError extends MediaServerServiceError> = new (
  code: string,
  message: string,
  status?: number,
) => TError;

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

export const toMediaServerServiceError = <TError extends MediaServerServiceError>(
  error: unknown,
  ErrorClass: MediaServerErrorClass<TError>,
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
  fallback: MediaServerErrorMapping,
): TError => {
  if (error instanceof ErrorClass) {
    return error;
  }

  const status = getHttpStatus(error);
  const mapped = status !== undefined ? statusMappings[status] : undefined;
  if (mapped) {
    return new ErrorClass(mapped.code, mapped.message, status);
  }

  return new ErrorClass(fallback.code, `${fallback.message}: ${toErrorMessage(error)}`, status);
};
