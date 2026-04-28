import {
  pickAutoResolvedUserId,
  toBooleanValue,
  toStringArray,
  toStringRecord,
  toStringValue,
} from "@main/services/common/mediaServer";
import type { Configuration } from "@main/services/config";
import {
  fetchMediaServerPersons,
  fetchMediaServerResolvedUserId,
  fetchMediaServerUserScopedItemDetail,
  type MediaServerItemDetail,
  uploadMediaServerPrimaryImage,
} from "@main/services/mediaServer/MediaServerClient";
import type { NetworkClient } from "@main/services/network";
import type { PlannedPersonSyncState } from "@main/services/personSync/planner";
import { isRecord } from "@main/utils/common";
import type { PersonSyncResult } from "@mdcz/shared/ipcTypes";
import { isUuid, type JellyfinMode } from "./auth";
import { JellyfinServiceError, toJellyfinServiceError } from "./errors";

export type JellyfinBatchResult = PersonSyncResult;
export type JellyfinItemDetail = MediaServerItemDetail;

export interface JellyfinPerson {
  Id: string;
  Name: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

const getConfiguredJellyfinUserId = (configuration: Configuration): string | undefined => {
  const trimmedUserId = configuration.jellyfin.userId.trim();
  if (trimmedUserId && !isUuid(trimmedUserId)) {
    throw new JellyfinServiceError("JELLYFIN_INVALID_USER_ID", "Jellyfin userId 必须为 UUID");
  }
  return trimmedUserId || undefined;
};

const fetchAutoResolvedJellyfinUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<string> => {
  return await fetchMediaServerResolvedUserId(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      path: "/Users",
      extractUsers: (response) => (Array.isArray(response) ? response : []),
      pickUserId: (users) => pickAutoResolvedUserId(users),
      createMissingUserContextError: () =>
        new JellyfinServiceError(
          "JELLYFIN_USER_CONTEXT_REQUIRED",
          "当前 Jellyfin 服务器要求用户上下文，请在设置中填写 Jellyfin 用户 ID 后重试",
        ),
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API Key 无效，无法读取用户列表" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有读取用户列表的权限" },
      },
      fallback: {
        code: "JELLYFIN_USER_CONTEXT_REQUIRED",
        message: "当前 Jellyfin 服务器要求用户上下文，请在设置中填写 Jellyfin 用户 ID 后重试",
      },
    },
  );
};

export const resolveJellyfinUserId = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<string> => {
  return (
    getConfiguredJellyfinUserId(configuration) ?? (await fetchAutoResolvedJellyfinUserId(networkClient, configuration))
  );
};

export const buildJellyfinPersonUpdatePayload = (
  person: JellyfinPerson,
  detail: JellyfinItemDetail,
  synced: PlannedPersonSyncState,
  lockOverview: boolean,
): Record<string, unknown> => {
  const genres = toStringArray(detail.Genres);
  const providerIds = toStringRecord(detail.ProviderIds);
  const lockedFields = Array.from(new Set(toStringArray(detail.LockedFields)));

  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
    Genres: genres,
    Tags: synced.tags,
    ProviderIds: providerIds,
    Taglines: synced.taglines,
    ProductionLocations: synced.productionLocations ?? [],
  };

  const serverId = toStringValue(detail.ServerId);
  if (serverId) {
    payload.ServerId = serverId;
  }

  const type = toStringValue(detail.Type);
  if (type) {
    payload.Type = type;
  }

  const personType = toStringValue(detail.PersonType);
  if (personType) {
    payload.PersonType = personType;
  }

  if (synced.premiereDate) {
    payload.PremiereDate = synced.premiereDate;
  }

  if (synced.productionYear !== undefined) {
    payload.ProductionYear = synced.productionYear;
  }

  if (lockOverview && !lockedFields.includes("Overview")) {
    lockedFields.push("Overview");
  }
  payload.LockedFields = lockedFields;

  const lockData = toBooleanValue(detail.LockData);
  if (lockOverview) {
    payload.LockData = true;
  } else {
    payload.LockData = lockData ?? false;
  }

  return payload;
};

export const fetchJellyfinPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: {
    limit?: number;
    fields?: string[];
    userId?: string;
  } = {},
): Promise<JellyfinPerson[]> => {
  const userId = options.userId ?? getConfiguredJellyfinUserId(configuration);

  return await fetchMediaServerPersons(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      query: {
        userId,
        personTypes: "Actor",
        Limit: options.limit !== undefined ? String(options.limit) : undefined,
        Fields: options.fields?.join(","),
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

        const id = toStringValue(item.Id);
        const name = toStringValue(item.Name);
        if (!id || !name) {
          return null;
        }

        return {
          Id: id,
          Name: name,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        };
      },
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 人物读取请求参数无效" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API Key 无效或已失效" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物读取权限" },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin 人物列表失败",
      },
    },
  );
};

export const fetchJellyfinPersonDetail = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  options: {
    userId?: string;
  } = {},
): Promise<JellyfinItemDetail> => {
  const userId = options.userId ?? (await resolveJellyfinUserId(networkClient, configuration));

  return await fetchMediaServerUserScopedItemDetail(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId: person.Id,
      userId,
      createMissingUserContextError: () =>
        new JellyfinServiceError(
          "JELLYFIN_USER_CONTEXT_REQUIRED",
          "当前 Jellyfin 服务器要求用户上下文，请在设置中填写 Jellyfin 用户 ID 后重试",
        ),
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: {
          code: "JELLYFIN_AUTH_FAILED",
          message: `读取人物详情失败：Jellyfin API Key 无效，无法访问 ${person.Name}`,
        },
        403: {
          code: "JELLYFIN_PERMISSION_DENIED",
          message: `读取人物详情失败：当前 Jellyfin API Key 无权访问 ${person.Name}`,
        },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Jellyfin 中不存在人物 ${person.Name}` },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: `读取人物详情失败：${person.Name}`,
      },
    },
  );
};

export const hasJellyfinPrimaryImage = (person: JellyfinPerson): boolean => {
  const primary = person.ImageTags?.Primary;
  return typeof primary === "string" && primary.trim().length > 0;
};

export const uploadJellyfinPrimaryImage = async (
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
      serverKey: "jellyfin",
      personId,
      bytes,
      contentType,
      retryableStatuses: [404, 405],
      fallbackPath: `${primaryPath}/0`,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物头像上传请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法上传人物头像" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物头像写入权限" },
        415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin 不接受当前头像文件类型" },
      },
      fallback: {
        code: "JELLYFIN_WRITE_FAILED",
        message: "上传 Jellyfin 人物头像失败",
      },
    },
  );
};

export type { JellyfinMode };
