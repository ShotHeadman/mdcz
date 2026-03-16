import { readFile } from "node:fs/promises";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { logActorSourceWarnings } from "@main/services/actorSource/logging";
import type { Configuration } from "@main/services/config";
import { assertLocalActorImageSourceReady } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { imageContentTypeFromPath, pathExists } from "@main/utils/file";
import { buildJellyfinHeaders, buildJellyfinUrl, type JellyfinMode } from "./auth";
import { getHttpStatus, JellyfinServiceError, toJellyfinServiceError } from "./errors";
import { fetchPersons, type JellyfinBatchResult, type JellyfinPerson, refreshPerson } from "./people";

export interface JellyfinActorPhotoDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  actorSourceProvider: ActorSourceProvider;
}

const hasPrimaryImage = (person: JellyfinPerson): boolean => {
  const primary = person.ImageTags?.Primary;
  return typeof primary === "string" && primary.trim().length > 0;
};

const uploadPrimaryImage = async (
  networkClient: NetworkClient,
  configuration: Configuration,
  personId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> => {
  const body = Buffer.from(bytes).toString("base64");
  const headers = buildJellyfinHeaders(configuration, {
    "content-type": contentType,
  });

  const primaryPath = `/Items/${encodeURIComponent(personId)}/Images/Primary`;
  try {
    await networkClient.postText(buildJellyfinUrl(configuration, primaryPath), body, { headers });
    return;
  } catch (error) {
    const status = getHttpStatus(error);
    if (status !== 404 && status !== 405) {
      throw toJellyfinServiceError(
        error,
        {
          400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物头像上传请求" },
          401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法上传人物头像" },
          403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物头像写入权限" },
          415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin 不接受当前头像文件类型" },
        },
        {
          code: "JELLYFIN_WRITE_FAILED",
          message: "上传 Jellyfin 人物头像失败",
        },
      );
    }
  }

  try {
    await networkClient.postText(buildJellyfinUrl(configuration, `${primaryPath}/0`), body, { headers });
  } catch (error) {
    throw toJellyfinServiceError(
      error,
      {
        400: { code: "JELLYFIN_BAD_REQUEST", message: "Jellyfin 拒绝了人物头像上传请求" },
        401: { code: "JELLYFIN_AUTH_FAILED", message: "Jellyfin 凭据无效，无法上传人物头像" },
        403: { code: "JELLYFIN_PERMISSION_DENIED", message: "当前 Jellyfin 凭据没有人物头像写入权限" },
        415: { code: "JELLYFIN_UNSUPPORTED_MEDIA", message: "Jellyfin 不接受当前头像文件类型" },
      },
      {
        code: "JELLYFIN_WRITE_FAILED",
        message: "上传 Jellyfin 人物头像失败",
      },
    );
  }
};

export class JellyfinActorPhotoService {
  private readonly logger = loggerService.getLogger("JellyfinActorPhoto");

  private readonly networkClient: NetworkClient;

  constructor(private readonly deps: JellyfinActorPhotoDependencies) {
    this.networkClient = deps.networkClient;
  }

  async run(configuration: Configuration, mode: JellyfinMode): Promise<JellyfinBatchResult> {
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
    let completed = 0;

    this.deps.signalService.resetProgress();

    for (const person of persons) {
      const actorName = person.Name.trim();

      try {
        if (!actorName) {
          failedCount += 1;
          continue;
        }

        if (mode === "missing" && hasPrimaryImage(person)) {
          continue;
        }

        const actorSource = await this.deps.actorSourceProvider.lookup(configuration, {
          name: actorName,
          requiredField: "photo_url",
        });
        logActorSourceWarnings(this.logger, actorName, actorSource.warnings);
        const photoUrl = actorSource.profile.photo_url?.trim();

        let content: Uint8Array | undefined;
        let contentType: string | undefined;

        if (photoUrl) {
          if (await pathExists(photoUrl)) {
            content = await readFile(photoUrl);
          } else {
            content = await this.networkClient.getContent(photoUrl, {
              headers: {
                accept: "image/*",
              },
            });
          }
          contentType = imageContentTypeFromPath(photoUrl);
        }

        if (!content || !contentType) {
          failedCount += 1;
          this.deps.signalService.showLogText(`No Jellyfin actor photo source found for ${actorName}`, "warn");
          continue;
        }

        await uploadPrimaryImage(this.networkClient, configuration, person.Id, content, contentType);
        if (configuration.jellyfin.refreshPersonAfterSync) {
          try {
            await refreshPerson(this.networkClient, configuration, person.Id);
          } catch (error) {
            const detail =
              error instanceof JellyfinServiceError
                ? `${error.code}: ${error.message}`
                : error instanceof Error
                  ? error.message
                  : String(error);
            this.logger.warn(`Failed to refresh Jellyfin actor ${person.Name} after photo sync: ${detail}`);
          }
        }
        processedCount += 1;
        this.deps.signalService.showLogText(`Updated Jellyfin actor photo: ${actorName}`);
      } catch (error) {
        failedCount += 1;
        const detail =
          error instanceof JellyfinServiceError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        this.logger.warn(`Failed to update Jellyfin actor photo for ${actorName}: ${detail}`);
      } finally {
        completed += 1;
        this.deps.signalService.setProgress(Math.round((completed / total) * 100), completed, total);
      }
    }

    this.deps.signalService.showLogText(
      `Jellyfin actor photo sync completed. Success: ${processedCount}, Failed: ${failedCount}`,
    );

    return {
      processedCount,
      failedCount,
    };
  }
}
