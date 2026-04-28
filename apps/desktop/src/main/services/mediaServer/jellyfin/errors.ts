import {
  getHttpStatus,
  type MediaServerErrorMapping,
  MediaServerServiceError,
  toMediaServerServiceError,
} from "@main/services/mediaServer/MediaServerError";

export { getHttpStatus };

export class JellyfinServiceError extends MediaServerServiceError {}

export const toJellyfinServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
  fallback: MediaServerErrorMapping,
): JellyfinServiceError => {
  return toMediaServerServiceError(error, JellyfinServiceError, statusMappings, fallback);
};
