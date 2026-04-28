import type { ActorSourceProvider } from "@main/services/actorSource";
import { toStringArray, toStringValue } from "@main/services/common/mediaServer";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import {
  buildJellyfinPersonUpdatePayload,
  fetchJellyfinPersonDetail,
  fetchJellyfinPersons,
  type JellyfinBatchResult,
  type JellyfinItemDetail,
  type JellyfinPerson,
  resolveJellyfinUserId,
} from "@main/services/mediaServer/jellyfin/JellyfinAdapter";
import {
  fetchMediaServerMetadataEditorInfo,
  refreshMediaServerPerson,
  updateMediaServerItem,
} from "@main/services/mediaServer/MediaServerClient";
import { runMediaServerInfoSync } from "@main/services/mediaServer/MediaServerInfoSync";
import type { NetworkClient } from "@main/services/network";
import type { PlannedPersonSyncState } from "@main/services/personSync/planner";
import type { SignalService } from "@main/services/SignalService";
import type { JellyfinMode } from "./auth";
import { toJellyfinServiceError } from "./errors";

export type { JellyfinBatchResult, JellyfinPerson };
export type ItemDetail = JellyfinItemDetail;
export { fetchJellyfinPersonDetail as fetchPersonDetail, fetchJellyfinPersons as fetchPersons, resolveJellyfinUserId };

export interface JellyfinActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export const fetchMetadataEditorInfo = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
): Promise<Record<string, unknown>> => {
  return await fetchMediaServerMetadataEditorInfo(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法校验人物写权限" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法获取人物元数据编辑页信息" },
      },
      fallback: {
        code: "JELLYFIN_UNREACHABLE",
        message: "读取 Jellyfin 人物元数据编辑页信息失败",
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
      serverKey: "jellyfin",
      personId,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物刷新请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法刷新人物" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物刷新权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: "Jellyfin 无法刷新指定人物" },
      },
      fallback: {
        code: "JELLYFIN_REFRESH_FAILED",
        message: "刷新 Jellyfin 人物失败",
      },
    },
  );
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
  const payload = buildJellyfinPersonUpdatePayload(person, detail, synced, options.lockOverview ?? false);
  await updateMediaServerItem(
    {
      networkClient,
      configuration,
      serverKey: "jellyfin",
      personId: person.Id,
      payload,
      toServiceError: toJellyfinServiceError,
    },
    {
      statusMappings: {
        400: { code: "JELLYFIN_BAD_REQUEST", message: `Jellyfin 拒绝更新人物信息：${person.Name}` },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法写入人物信息" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物写入权限" },
        404: { code: "JELLYFIN_NOT_FOUND", message: `Jellyfin 中不存在人物 ${person.Name}` },
      },
      fallback: {
        code: "JELLYFIN_WRITE_FAILED",
        message: `写入 Jellyfin 人物信息失败：${person.Name}`,
      },
    },
  );
};

export class JellyfinActorInfoService {
  private readonly logger = loggerService.getLogger("JellyfinActorInfo");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: JellyfinActorInfoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
    const resolvedUserId = await resolveJellyfinUserId(this.networkClient, configuration);
    return await runMediaServerInfoSync({
      configuration,
      mode,
      serviceName: "Jellyfin",
      signalService: this.deps.signalService,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.logger,
      fetchPersons: async () =>
        await fetchJellyfinPersons(this.networkClient, configuration, {
          fields: ["Overview"],
          userId: resolvedUserId,
        }),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      fetchPersonDetail: async (person) =>
        await fetchJellyfinPersonDetail(this.networkClient, configuration, person, {
          userId: resolvedUserId,
        }),
      buildExistingState: (person, detail) => ({
        overview: toStringValue(detail.Overview) ?? person.Overview,
        tags: toStringArray(detail.Tags),
        taglines: toStringArray(detail.Taglines),
        premiereDate: toStringValue(detail.PremiereDate),
        productionYear: typeof detail.ProductionYear === "number" ? detail.ProductionYear : undefined,
        productionLocations: toStringArray(detail.ProductionLocations),
      }),
      updatePersonInfo: async (person, detail, synced) => {
        await updatePersonInfo(this.networkClient, configuration, person, detail, synced, {
          lockOverview: configuration.jellyfin.lockOverviewAfterSync,
        });
      },
      shouldRefreshPerson: configuration.jellyfin.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshPerson(this.networkClient, configuration, personId);
      },
    });
  }
}
