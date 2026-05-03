import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import {
  buildEmbyHeaders,
  buildEmbyPersonUpdatePayload,
  buildEmbyUrl,
  createEmbyConnectionExtraSteps,
  type EmbyBatchResult,
  type EmbyItemDetail,
  type EmbyMode,
  type EmbyPerson,
  EmbyServiceError,
  fetchEmbyActorPersons,
  fetchEmbyMetadataEditorInfo,
  fetchEmbyPersonDetail,
  fetchEmbyPersons,
  getHttpStatus,
  hasEmbyPrimaryImage,
  normalizeEmbyBaseUrl,
  parseEmbyMode,
  refreshEmbyPerson,
  resolveEmbyUserId,
  toEmbyServiceError,
  toStringArray,
  toStringRecord,
  toStringValue,
  uploadEmbyPrimaryImage,
} from "@mdcz/runtime/mediaserver";

export type { EmbyBatchResult, EmbyMode, EmbyPerson };
export { toStringArray, toStringRecord, toStringValue };
export type ItemDetail = EmbyItemDetail;
export {
  buildEmbyHeaders,
  buildEmbyPersonUpdatePayload,
  buildEmbyUrl,
  createEmbyConnectionExtraSteps,
  EmbyServiceError,
  fetchEmbyActorPersons as fetchActorPersons,
  fetchEmbyPersonDetail as fetchPersonDetail,
  fetchEmbyPersons as fetchPersons,
  getHttpStatus,
  hasEmbyPrimaryImage as hasPrimaryImage,
  normalizeEmbyBaseUrl as normalizeBaseUrl,
  parseEmbyMode as parseMode,
  resolveEmbyUserId,
  toEmbyServiceError,
  uploadEmbyPrimaryImage,
};

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => await fetchEmbyMetadataEditorInfo(networkClient, configuration, personId);

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await refreshEmbyPerson(networkClient, configuration, personId);
};
