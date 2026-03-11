import type { ActorSourceProvider } from "@main/services/actorSource";
import { logActorSourceWarnings } from "@main/services/actorSource/logging";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import {
  hasMissingActorInfo,
  normalizeExistingPersonSyncState,
  type PlannedPersonSyncState,
  planPersonSync,
} from "@main/services/personSync/planner";
import type { SignalService } from "@main/services/SignalService";
import { buildJellyfinHeaders, buildJellyfinUrl, isUuid, type JellyfinMode } from "./auth";
import { JellyfinServiceError, toJellyfinServiceError } from "./errors";

interface JellyfinPersonsResponse {
  Items?: unknown;
}

type ItemDetail = Record<string, unknown>;

export interface JellyfinBatchResult {
  processedCount: number;
  failedCount: number;
}

export interface JellyfinPerson {
  Id: string;
  Name: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

export interface JellyfinActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const toStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    const normalized = toStringValue(recordValue);
    if (normalized) {
      output[key] = normalized;
    }
  }
  return output;
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const buildPersonUpdatePayload = (
  person: JellyfinPerson,
  detail: ItemDetail,
  synced: PlannedPersonSyncState,
  lockOverview: boolean,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    Id: person.Id,
    Name: toStringValue(detail.Name) ?? person.Name,
    Overview: synced.overview ?? "",
  };

  const serverId = toStringValue(detail.ServerId);
  if (serverId) {
    payload.ServerId = serverId;
  }

  const genres = toStringArray(detail.Genres);
  if (genres.length > 0) {
    payload.Genres = genres;
  }

  if (synced.tags.length > 0) {
    payload.Tags = synced.tags;
  }

  const providerIds = toStringRecord(detail.ProviderIds);
  if (Object.keys(providerIds).length > 0) {
    payload.ProviderIds = providerIds;
  }

  if (synced.taglines.length > 0) {
    payload.Taglines = synced.taglines;
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

  const lockedFields = Array.from(new Set(toStringArray(detail.LockedFields)));
  if (lockOverview && !lockedFields.includes("Overview")) {
    lockedFields.push("Overview");
  }
  if (lockedFields.length > 0) {
    payload.LockedFields = lockedFields;
  }

  const lockData = toBooleanValue(detail.LockData);
  if (lockOverview) {
    payload.LockData = true;
  } else if (lockData !== undefined) {
    payload.LockData = lockData;
  }

  return payload;
};

export const fetchPersons = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  options: {
    limit?: number;
    fields?: string[];
  } = {},
): Promise<JellyfinPerson[]> => {
  const trimmedUserId = configuration.jellyfin.userId.trim();
  if (trimmedUserId && !isUuid(trimmedUserId)) {
    throw new JellyfinServiceError("JELLYFIN_INVALID_USER_ID", "Jellyfin userId 必须为 UUID");
  }

  const url = buildJellyfinUrl(configuration, "/Persons", {
    userId: trimmedUserId || undefined,
    Limit: options.limit !== undefined ? String(options.limit) : undefined,
    Fields: options.fields?.join(","),
  });

  try {
    const response = await networkClient.getJson<JellyfinPersonsResponse>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });

    if (!Array.isArray(response.Items)) {
      return [];
    }

    return response.Items.flatMap((item): JellyfinPerson[] => {
      if (!isRecord(item)) {
        return [];
      }

      const id = toStringValue(item.Id);
      const name = toStringValue(item.Name);
      if (!id || !name) {
        return [];
      }

      return [
        {
          Id: id,
          Name: name,
          Overview: toStringValue(item.Overview),
          ImageTags: isRecord(item.ImageTags) ? toStringRecord(item.ImageTags) : undefined,
        },
      ];
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 人物读取请求参数无效" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin API Key 无效或已失效" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物读取权限" },
      },
      {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin 人物列表失败",
      },
    );
  }
};

export const fetchPersonDetail = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
): Promise<ItemDetail> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

  try {
    return await networkClient.getJson<ItemDetail>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
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
      {
        code: "JELLYFIN_UNREACHABLE",
        message: `读取人物详情失败：${person.Name}`,
      },
    );
  }
};

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(personId)}/MetadataEditor`);

  try {
    return await networkClient.getJson<Record<string, unknown>>(url, {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法校验人物写权限" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法获取人物元数据编辑页信息" },
      },
      {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin 人物元数据编辑页信息失败",
      },
    );
  }
};

export const refreshPerson = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<void> => {
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(personId)}/Refresh`, {
    Recursive: "false",
    MetadataRefreshMode: "FullRefresh",
    ImageRefreshMode: "FullRefresh",
    ReplaceAllMetadata: "false",
    ReplaceAllImages: "false",
  });

  try {
    await networkClient.postText(url, "", {
      headers: buildJellyfinHeaders(configuration),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物刷新请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法刷新人物" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物刷新权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法刷新指定人物" },
      },
      {
        code: "JELLYFIN_REFRESH_FAILED",
        message: "刷新 Jellyfin 人物失败",
      },
    );
  }
};

export const updatePersonInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  person: JellyfinPerson,
  detail: ItemDetail,
  synced: PlannedPersonSyncState,
  options: {
    lockOverview?: boolean;
  } = {},
): Promise<void> => {
  const payload = buildPersonUpdatePayload(person, detail, synced, options.lockOverview ?? false);
  const url = buildJellyfinUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

  try {
    await networkClient.postText(url, JSON.stringify(payload), {
      headers: buildJellyfinHeaders(configuration, {
        "content-type": "application/json",
      }),
    });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: `Jellyfin 拒绝更新人物信息：${person.Name}` },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法写入人物信息" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Jellyfin 中不存在人物 ${person.Name}` },
      },
      {
        code: "JELLYFIN_WRITE_FAILED",
        message: `写入 Jellyfin 人物信息失败：${person.Name}`,
      },
    );
  }
};

export class JellyfinActorInfoService {
  private readonly logger = loggerService.getLogger("JellyfinActorInfo");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: JellyfinActorInfoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    const persons = await fetchPersons(this.networkClient, configuration, {
      fields: ["Overview"],
    });
    const total = persons.length;

    if (total === 0) {
      return {
        processedCount: 0,
        failedCount: 0,
      };
    }

    let processedCount = 0;
    let failedCount = 0;
    let current = 0;

    this.deps.signalService.resetProgress();

    for (const person of persons) {
      current += 1;
      this.deps.signalService.setProgress(Math.round((current / total) * 100), current, total);

      try {
        const detail = await fetchPersonDetail(this.networkClient, configuration, person);
        const existing = normalizeExistingPersonSyncState({
          overview: toStringValue(detail.Overview) ?? person.Overview,
          tags: toStringArray(detail.Tags),
          taglines: toStringArray(detail.Taglines),
          premiereDate: toStringValue(detail.PremiereDate),
          productionYear: typeof detail.ProductionYear === "number" ? detail.ProductionYear : undefined,
          productionLocations: toStringArray(detail.ProductionLocations),
        });

        if (mode === "missing" && !hasMissingActorInfo(existing)) {
          continue;
        }

        const source = await this.deps.actorSourceProvider.lookup(configuration, person.Name);
        logActorSourceWarnings(this.logger, person.Name, source.warnings);
        const synced = planPersonSync(source.profile, existing, mode);
        if (!synced.shouldUpdate) {
          continue;
        }

        await updatePersonInfo(this.networkClient, configuration, person, detail, synced, {
          lockOverview: configuration.jellyfin.lockOverviewAfterSync,
        });
        if (configuration.jellyfin.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to refresh Jellyfin actor ${person.Name} after info sync: ${message}`);
          }
        }
        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Jellyfin actor info: ${person.Name}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update Jellyfin actor info for ${person.Name}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Jellyfin actor info sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }
}
