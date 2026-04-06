import { toStringArray, toStringRecord, toStringValue } from "@main/services/common/mediaServer";
import type { Configuration } from "@main/services/config";
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
  fetchEmbyPersonDetail,
  fetchEmbyPersons,
  getHttpStatus,
  hasEmbyPrimaryImage,
  normalizeEmbyBaseUrl,
  parseEmbyMode,
  resolveEmbyUserId,
  toEmbyServiceError,
  uploadEmbyPrimaryImage,
} from "@main/services/mediaServer/emby/EmbyAdapter";
import {
  fetchMediaServerMetadataEditorInfo,
  refreshMediaServerPerson,
} from "@main/services/mediaServer/MediaServerClient";
import type { NetworkClient } from "@main/services/network";

export { toStringArray, toStringRecord, toStringValue };
export type { EmbyBatchResult, EmbyMode, EmbyPerson };
export type ItemDetail = EmbyItemDetail;
export {
  EmbyServiceError,
  buildEmbyHeaders,
  buildEmbyPersonUpdatePayload,
  buildEmbyUrl,
  createEmbyConnectionExtraSteps,
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
): Promise<Record<string, unknown>> => {
  return await fetchMediaServerMetadataEditorInfo(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法校验人物写权限" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物写入权限" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法获取人物元数据编辑页信息" },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: "读取 Emby 人物元数据编辑页信息失败",
      },
    },
  );
};

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  await refreshMediaServerPerson(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物刷新请求" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法刷新人物" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物刷新权限" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法刷新指定人物" },
      },
      fallback: {
        code: "EMBY_REFRESH_FAILED",
        message: "刷新 Emby 人物失败",
      },
    },
  );
};
