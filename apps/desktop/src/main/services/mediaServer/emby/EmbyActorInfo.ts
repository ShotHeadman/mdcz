import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { updateMediaServerItem } from "@main/services/mediaServer/MediaServerClient";
import { runMediaServerInfoSync } from "@main/services/mediaServer/MediaServerInfoSync";
import type { NetworkClient } from "@main/services/network";
import type { PlannedPersonSyncState } from "@main/services/personSync/planner";
import type { SignalService } from "@main/services/SignalService";
import {
  buildEmbyPersonUpdatePayload,
  type EmbyBatchResult,
  type EmbyMode,
  type EmbyPerson,
  fetchActorPersons,
  fetchPersonDetail,
  type ItemDetail,
  refreshPerson,
  resolveEmbyUserId,
  toEmbyServiceError,
  toStringArray,
  toStringValue,
} from "./common";

export interface EmbyActorInfoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

export class EmbyActorInfoService {
  private readonly logger = loggerService.getLogger("EmbyActorInfo");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: EmbyActorInfoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    const resolvedUserId = await resolveEmbyUserId(this.networkClient, configuration);
    return await runMediaServerInfoSync({
      configuration,
      mode,
      serviceName: "Emby",
      signalService: this.deps.signalService,
      actorSourceProvider: this.deps.actorSourceProvider,
      logger: this.logger,
      fetchPersons: async () =>
        await fetchActorPersons(this.networkClient, configuration, {
          fields: ["Overview"],
          userId: resolvedUserId,
        }),
      getPersonName: (person) => person.Name,
      getPersonId: (person) => person.Id,
      fetchPersonDetail: async (person) =>
        await fetchPersonDetail(this.networkClient, configuration, person, resolvedUserId),
      buildExistingState: (person, detail) => ({
        overview: toStringValue(detail.Overview) ?? person.Overview,
        tags: toStringArray(detail.Tags),
        taglines: toStringArray(detail.Taglines),
        premiereDate: toStringValue(detail.PremiereDate),
        productionYear: typeof detail.ProductionYear === "number" ? detail.ProductionYear : undefined,
        productionLocations: toStringArray(detail.ProductionLocations),
      }),
      updatePersonInfo: async (person, detail, synced) => {
        await this.updatePersonInfo(configuration, person, detail, synced);
      },
      shouldRefreshPerson: configuration.emby.refreshPersonAfterSync,
      refreshPerson: async (personId) => {
        await refreshPerson(this.networkClient, configuration, personId);
      },
      buildCompletionMessage: (result, total) =>
        `Emby actor info sync completed. Total: ${total}, Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
    });
  }

  private async updatePersonInfo(
    configuration: Configuration,
    person: EmbyPerson,
    detail: ItemDetail,
    synced: PlannedPersonSyncState,
  ): Promise<void> {
    const payload = buildEmbyPersonUpdatePayload(person, detail, synced);
    await updateMediaServerItem(
      {
        networkClient: this.networkClient,
        configuration,
        serverKey: "emby",
        personId: person.Id,
        payload,
        toServiceError: toEmbyServiceError,
      },
      {
        statusMappings: {
          400: { code: "EMBY_BAD_REQUEST", message: `Emby 拒绝更新人物信息：${person.Name}` },
          401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法写入人物信息" },
          403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物写入权限" },
          404: { code: "EMBY_NOT_FOUND", message: `Emby 中不存在人物 ${person.Name}` },
        },
        fallback: {
          code: "EMBY_WRITE_FAILED",
          message: `写入 Emby 人物信息失败：${person.Name}`,
        },
      },
    );
  }
}
