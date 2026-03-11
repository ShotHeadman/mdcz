import { readFile } from "node:fs/promises";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { logActorSourceWarnings } from "@main/services/actorSource/logging";
import type { Configuration } from "@main/services/config";
import { assertLocalActorImageSourceReady } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { imageContentTypeFromPath, pathExists } from "@main/utils/file";
import {
  buildEmbyHeaders,
  buildEmbyUrl,
  type EmbyBatchResult,
  type EmbyMode,
  fetchPersons,
  getHttpStatus,
  hasPrimaryImage,
  refreshPerson,
  toEmbyServiceError,
} from "./common";

export interface EmbyActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

const uploadPrimaryImage = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const body = Buffer.from(bytes).toString("base64");
  const headers = buildEmbyHeaders(configuration, {
    "content-type": contentType,
  });
  const primaryPath = `/Items/${encodeURIComponent(personId)}/Images/Primary`;

  try {
    await networkClient.postText(buildEmbyUrl(configuration, primaryPath), body, { headers });
    return;
  } catch (error) {
    const status = getHttpStatus(error);
    if (status !== 400 && status !== 404 && status !== 405) {
      throw toEmbyServiceError(
        error,
        {
          400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物头像上传请求" },
          401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法上传人物头像" },
          403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby 人物头像上传需要管理员 API Key" },
          415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby 不接受当前头像文件类型" },
        },
        {
          code: "EMBY_WRITE_FAILED",
          message: "上传 Emby 人物头像失败",
        },
      );
    }
  }

  try {
    await networkClient.postText(buildEmbyUrl(configuration, primaryPath, { Index: "0" }), body, { headers });
  } catch (error) {
    throw toEmbyServiceError(
      error,
      {
        400: { code: "EMBY_BAD_REQUEST", message: "Emby 拒绝了人物头像上传请求" },
        401: { code: "EMBY_AUTH_FAILED", message: "Emby API Key 无效，无法上传人物头像" },
        403: { code: "EMBY_ADMIN_KEY_REQUIRED", message: "Emby 人物头像上传需要管理员 API Key" },
        404: { code: "EMBY_NOT_FOUND", message: "Emby 无法找到需要写入头像的人物" },
        415: { code: "EMBY_UNSUPPORTED_MEDIA", message: "Emby 不接受当前头像文件类型" },
      },
      {
        code: "EMBY_WRITE_FAILED",
        message: "上传 Emby 人物头像失败",
      },
    );
  }
};

export class EmbyActorPhotoService {
  private readonly logger = loggerService.getLogger("EmbyActorPhoto");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: EmbyActorPhotoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: EmbyMode): Promise<EmbyBatchResult> {
    assertLocalActorImageSourceReady(configuration);

    const persons = await fetchPersons(this.networkClient, configuration);
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

      if (mode === "missing" && hasPrimaryImage(person)) {
        continue;
      }

      const actorName = person.Name.trim();
      if (!actorName) {
        failedCount += 1;
        continue;
      }

      try {
        const actorSource = await this.deps.actorSourceProvider.lookup(configuration, actorName);
        logActorSourceWarnings(this.logger, actorName, actorSource.warnings);
        const photoUrl = actorSource.profile.photo_url?.trim();

        let content: Buffer | Uint8Array | undefined;
        let contentType: string | undefined;

        if (photoUrl && (await pathExists(photoUrl))) {
          content = await readFile(photoUrl);
          contentType = imageContentTypeFromPath(photoUrl);
        } else if (photoUrl) {
          content = await this.networkClient.getContent(photoUrl, {
            headers: {
              accept: "image/*",
            },
          });
          contentType = imageContentTypeFromPath(photoUrl);
        }

        if (!content || !contentType) {
          failedCount += 1;
          this.deps.signalService.showLogText(`No Emby actor photo source found for ${actorName}`, "warn");
          continue;
        }

        await uploadPrimaryImage(this.networkClient, configuration, person.Id, content, contentType);
        if (configuration.emby.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to refresh Emby actor ${person.Name} after photo sync: ${message}`);
          }
        }

        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Emby actor photo: ${actorName}`);
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to update Emby actor photo for ${actorName}: ${message}`);
      }
    }

    this.deps.signalService.showLogText(
      `Emby actor photo sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }
}
