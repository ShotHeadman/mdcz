import {
  pickAutoResolvedUserId,
  toStringArray,
  toStringRecord,
  toStringValue,
} from "@main/services/common/mediaServer";
import type { Configuration } from "@main/services/config";
import {
  buildMediaServerHeaders,
  buildMediaServerUrl,
  fetchMediaServerPersons,
  fetchMediaServerResolvedUserId,
  fetchMediaServerUserScopedItemDetail,
  type MediaServerHeadersInit,
  type MediaServerItemDetail,
  type MediaServerMode,
  normalizeMediaServerBaseUrl,
  normalizeMediaServerPersons,
  parseMediaServerMode,
  uploadMediaServerPrimaryImage,
} from "@main/services/mediaServer/MediaServerClient";
import {
  getHttpStatus,
  type MediaServerErrorMapping,
  MediaServerServiceError,
  toMediaServerServiceError,
} from "@main/services/mediaServer/MediaServerError";
import type { NetworkClient } from "@main/services/network";
import type { PlannedPersonSyncState } from "@main/services/personSync/planner";
import { isRecord, isString } from "@main/utils/common";
import type { ConnectionCheckStatus, PersonSyncResult } from "@mdcz/shared/ipcTypes";

export type EmbyMode = MediaServerMode;
export type EmbyBatchResult = PersonSyncResult;
export type EmbyItemDetail = MediaServerItemDetail;

export interface EmbyPerson {
  Id: string;
  Name: string;
  ServerId?: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

export class EmbyServiceError extends MediaServerServiceError {}

export const normalizeEmbyBaseUrl = normalizeMediaServerBaseUrl;
export const parseEmbyMode = parseMediaServerMode;

export { getHttpStatus };

export const toEmbyServiceError = (
  error: unknown,
  statusMappings: Partial<Record<number, MediaServerErrorMapping>>,
  fallback: MediaServerErrorMapping,
): EmbyServiceError => {
  return toMediaServerServiceError(error, EmbyServiceError, statusMappings, fallback);
};

export const buildEmbyUrl = (
  configuration: Configuration,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  return buildMediaServerUrl(configuration, "emby", path, query);
};

export const buildEmbyHeaders = (configuration: Configuration, headers: MediaServerHeadersInit = {}): Headers => {
  return buildMediaServerHeaders(configuration, "emby", headers);
};

export const hasEmbyPrimaryImage = (person: EmbyPerson): boolean => {
  const primary = person.ImageTags?.Primary;
  return typeof primary === "string" && primary.trim().length > 0;
};

const ACTOR_PERSON_TYPES = ["Actor", "GuestStar"] as const;

type EmbyFetchPersonsOptions = {
  limit?: number;
  fields?: string[];
  userId?: string;
  personTypes?: string[];
};

const fetchAutoResolvedEmbyUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<string> => {
  return await fetchMediaServerResolvedUserId(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      path: "/Users/Query",
      extractUsers: (response) => (isRecord(response) && Array.isArray(response.Items) ? response.Items : []),
      pickUserId: (users) => pickAutoResolvedUserId(users),
      createMissingUserContextError: () =>
        new EmbyServiceError(
          "EMBY_USER_CONTEXT_REQUIRED",
          "当前 Emby 服务器要求用户上下文，请在设置中填写 Emby 用户 ID 后重试",
        ),
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法读取用户列表" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有读取用户列表的权限" },
      },
      fallback: {
        code: "EMBY_USER_CONTEXT_REQUIRED",
        message: "当前 Emby 服务器要求用户上下文，请在设置中填写 Emby 用户 ID 后重试",
      },
    },
  );
};

export const resolveEmbyUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  overrideUserId?: string,
): Promise<string> => {
  const resolvedUserId = overrideUserId?.trim() || configuration.emby.userId.trim();
  return resolvedUserId || (await fetchAutoResolvedEmbyUserId(networkClient, configuration));
};

export const fetchEmbyPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: EmbyFetchPersonsOptions = {},
): Promise<EmbyPerson[]> => {
  const userId = options.userId?.trim() || configuration.emby.userId.trim() || undefined;

  return await fetchMediaServerPersons(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      query: {
        userid: userId,
        Limit: options.limit !== undefined ? String(options.limit) : undefined,
        Fields: options.fields?.join(","),
        PersonTypes: options.personTypes?.join(","),
      },
      extractItems: (response) => {
        if (!isRecord(response) || !Array.isArray(response.Items)) {
          return [];
        }
        return response.Items;
      },
      parsePerson: (item) => {
        if (!isRecord(item)) {
          return null;
        }

        const id = item.Id;
        const name = item.Name;
        if (!isString(id) || !isString(name)) {
          return null;
        }

        return {
          Id: id,
          Name: name,
          ServerId: isString(item.ServerId) ? item.ServerId : undefined,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        };
      },
      normalizePersons: normalizeMediaServerPersons,
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 人物读取请求参数无效" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效或已失效" },
        403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物读取权限" },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: "读取 Emby 人物列表失败",
      },
    },
  );
};

export const fetchEmbyActorPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: Omit<EmbyFetchPersonsOptions, "personTypes"> = {},
): Promise<EmbyPerson[]> => {
  const userId = await resolveEmbyUserId(networkClient, configuration, options.userId);
  return await fetchEmbyPersons(networkClient, configuration, {
    ...options,
    userId,
    personTypes: [...ACTOR_PERSON_TYPES],
  });
};

export const fetchEmbyPersonDetail = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: EmbyPerson,
  userId: string,
): Promise<EmbyItemDetail> => {
  return await fetchMediaServerUserScopedItemDetail(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId: person.Id,
      userId,
      createMissingUserContextError: () =>
        new EmbyServiceError(
          "EMBY_USER_CONTEXT_REQUIRED",
          "当前 Emby 服务器要求用户上下文，请先解析并传入 Emby 用户 ID 后重试",
        ),
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        401: { code: "EMBY_AUTH_FAILED", message: `读取人物详情失败：Emby API Key 无效，无法访问 ${person.Name}` },
        403: { code: "EMBY_PERMISSION_DENIED", message: `读取人物详情失败：当前 Emby API Key 无权访问 ${person.Name}` },
        404: { code: "EMBY_NOT_FOUND", message: `Emby 中不存在人物 ${person.Name}` },
      },
      fallback: {
        code: "EMBY_UNREACHABLE",
        message: `读取 Emby 人物详情失败：${person.Name}`,
      },
    },
  );
};

export const buildEmbyPersonUpdatePayload = (
  person: EmbyPerson,
  detail: EmbyItemDetail,
  synced: PlannedPersonSyncState,
): Record<string, unknown> => {
  const hasOwn = (key: string): boolean => Object.hasOwn(detail, key);
  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
    Tags: synced.tags,
    Taglines: synced.taglines,
  };

  if (hasOwn("ProviderIds")) {
    payload.ProviderIds = toStringRecord(detail.ProviderIds);
  }
  if (hasOwn("LockedFields")) {
    payload.LockedFields = toStringArray(detail.LockedFields);
  }
  if (typeof detail.LockData === "boolean") {
    payload.LockData = detail.LockData;
  }

  const serverId = toStringValue(detail.ServerId) ?? person.ServerId;
  if (serverId) {
    payload.ServerId = serverId;
  }

  const genres = toStringArray(detail.Genres);
  if (genres.length > 0) {
    payload.Genres = genres;
  }

  const type = toStringValue(detail.Type);
  if (type) {
    payload.Type = type;
  }

  if (synced.productionLocations && synced.productionLocations.length > 0) {
    payload.ProductionLocations = synced.productionLocations;
  }

  if (synced.premiereDate) {
    payload.PremiereDate = synced.premiereDate;
  }

  if (synced.productionYear !== undefined) {
    payload.ProductionYear = synced.productionYear;
  }

  return payload;
};

export const uploadEmbyPrimaryImage = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const primaryPath = `/Items/${encodeURIComponent(personId)}/Images/Primary`;
  await uploadMediaServerPrimaryImage(
    {
      networkClient,
      configuration,
      serverKey: "emby",
      personId,
      bytes,
      contentType,
      retryableStatuses: [400, 404, 405],
      fallbackPath: primaryPath,
      fallbackQuery: { Index: "0" },
      toServiceError: toEmbyServiceError,
    },
    {
      statusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物头像上传请求" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法上传人物头像" },
        403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby 人物头像上传需要管理员 API Key" },
        415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby 不接受当前头像文件类型" },
      },
      fallback: {
        code: "EMBY_WRITE_FAILED",
        message: "上传 Emby 人物头像失败",
      },
      fallbackStatusMappings: {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物头像上传请求" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法上传人物头像" },
        403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby 人物头像上传需要管理员 API Key" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法找到需要写入头像的人物" },
        415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby 不接受当前头像文件类型" },
      },
    },
  );
};

export const createEmbyConnectionExtraSteps = <TStep>(
  createStep: (key: "adminKey", status: ConnectionCheckStatus, message: string, code?: string) => TStep,
) => ({
  afterServerUnreachable: [createStep("adminKey", "skipped", "未执行：服务不可达")],
  afterAuthFailure: (skippedReason: string) => [createStep("adminKey", "skipped", skippedReason)],
  afterEmptyLibrary: [
    createStep(
      "adminKey",
      "skipped",
      "人物头像上传通常需要管理员 API Key。当前 Emby 人物库为空，暂时无法结合实际结果校验。",
    ),
  ],
  afterWriteSuccess: [
    createStep(
      "adminKey",
      "skipped",
      "人物头像上传通常需要管理员 API Key。诊断不会执行实际写入验证；如果头像同步返回 401 或 403，请改用管理员 API Key。",
    ),
  ],
  afterPeopleFailure: [createStep("adminKey", "skipped", "未执行：前置人物权限校验未完成")],
});
