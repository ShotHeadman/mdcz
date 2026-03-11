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
import {
  buildEmbyHeaders,
  buildEmbyUrl,
  type EmbyBatchResult,
  type EmbyMode,
  type EmbyPerson,
  fetchPersonDetail,
  fetchPersons,
  type ItemDetail,
  refreshPerson,
  toEmbyServiceError,
  toStringArray,
  toStringRecord,
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

        const actorSource = await this.deps.actorSourceProvider.lookup(configuration, person.Name);
        logActorSourceWarnings(this.logger, person.Name, actorSource.warnings);
        const synced = planPersonSync(actorSource.profile, existing, mode);
        if (!synced.shouldUpdate) {
          continue;
        }

        await this.updatePersonInfo(configuration, person, detail, synced);
        if (configuration.emby.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to refresh Emby actor ${person.Name} after info sync: ${message}`);
          }
        }

        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Emby actor info: ${person.Name}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update Emby actor info for ${person.Name}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Emby actor info sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }

  private buildUpdatePayload(
    person: EmbyPerson,
    detail: ItemDetail,
    synced: PlannedPersonSyncState,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      Id: person.Id,
      Name: toStringValue(detail.Name) ?? person.Name,
      Overview: synced.overview ?? toStringValue(detail.Overview) ?? "",
    };

    const serverId = toStringValue(detail.ServerId) ?? person.ServerId;
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

    return payload;
  }

  private async updatePersonInfo(
    configuration: Configuration,
    person: EmbyPerson,
    detail: ItemDetail,
    synced: PlannedPersonSyncState,
  ): Promise<void> {
    const payload = this.buildUpdatePayload(person, detail, synced);
    const updateUrl = buildEmbyUrl(configuration, `/Items/${encodeURIComponent(person.Id)}`);

    try {
      await this.networkClient.postText(updateUrl, JSON.stringify(payload), {
        headers: buildEmbyHeaders(configuration, {
          "content-type": "application/json",
        }),
      });
    } catch (error) {
      throw toEmbyServiceError(
        error,
        {
          400: { code: "EMBY_BAD_REQUEST", message: `Emby 拒绝更新人物信息：${person.Name}` },
          401: { code: "EMBY_AUTH_FAILED", message: "Emby 凭据无效，无法写入人物信息" },
          403: { code: "EMBY_PERMISSION_DENIED", message: "当前 Emby 凭据没有人物写入权限" },
          404: { code: "EMBY_NOT_FOUND", message: `Emby 中不存在人物 ${person.Name}` },
        },
        {
          code: "EMBY_WRITE_FAILED",
          message: `写入 Emby 人物信息失败：${person.Name}`,
        },
      );
    }
  }
}
