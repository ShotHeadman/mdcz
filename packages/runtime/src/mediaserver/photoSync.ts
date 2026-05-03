import type { Configuration } from "@mdcz/shared/config";
import type { PersonSyncResult } from "@mdcz/shared/ipcTypes";
import type { RuntimeNetworkClient } from "../network";
import type { MediaServerMode } from ".";
import {
  createEmptyPersonSyncResult,
  formatPersonSyncError,
  loadPrimaryImageFromSource,
  runPersonSyncBatch,
} from "./personSync";

interface MediaServerPhotoSyncLogger {
  warn(message: string): void;
}

export interface RuntimePhotoActorSourceProvider {
  lookup(
    configuration: Configuration,
    query: string | { name: string; requiredField?: "photo_url" },
  ): Promise<{
    profile: { photo_url?: string };
    warnings?: string[];
  }>;
}

const logActorSourceWarnings = (
  logger: MediaServerPhotoSyncLogger,
  actorName: string,
  warnings: string[] | undefined,
): void => {
  for (const warning of warnings ?? []) {
    logger.warn(`Actor source warning for ${actorName}: ${warning}`);
  }
};

interface ProgressSignalService {
  resetProgress(): void;
  setProgress(value: number, current?: number, total?: number): void;
  showLogText(message: string, level?: "info" | "warn" | "error"): void;
}

interface MediaServerPhotoSyncOptions<TPerson> {
  configuration: Configuration;
  mode: MediaServerMode;
  serviceName: string;
  signalService: ProgressSignalService;
  networkClient: RuntimeNetworkClient;
  actorSourceProvider: RuntimePhotoActorSourceProvider;
  logger: MediaServerPhotoSyncLogger;
  fetchPersons: () => Promise<ReadonlyArray<TPerson>>;
  getPersonName: (person: TPerson) => string;
  getPersonId: (person: TPerson) => string;
  hasPrimaryImage: (person: TPerson) => boolean;
  uploadPrimaryImage: (personId: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  shouldRefreshPerson: boolean;
  refreshPerson: (personId: string) => Promise<void>;
  buildCompletionMessage?: (result: PersonSyncResult, total: number) => string;
}

export const runMediaServerPhotoSync = async <TPerson>(
  options: MediaServerPhotoSyncOptions<TPerson>,
): Promise<PersonSyncResult> => {
  const persons = await options.fetchPersons();
  if (persons.length === 0) {
    return createEmptyPersonSyncResult();
  }

  const result = await runPersonSyncBatch({
    items: persons,
    signalService: options.signalService,
    processItem: async (person) => {
      const actorName = options.getPersonName(person).trim();
      if (!actorName) {
        return "skipped";
      }

      if (options.mode === "missing" && options.hasPrimaryImage(person)) {
        return "skipped";
      }

      const actorSource = await options.actorSourceProvider.lookup(options.configuration, {
        name: actorName,
        requiredField: "photo_url",
      });
      logActorSourceWarnings(options.logger, actorName, actorSource.warnings);
      const image = await loadPrimaryImageFromSource(options.networkClient, actorSource.profile.photo_url);

      if (!image) {
        options.signalService.showLogText(
          `No ${options.serviceName} actor photo source found for ${actorName}`,
          "warn",
        );
        return "skipped";
      }

      await options.uploadPrimaryImage(options.getPersonId(person), image.content, image.contentType);
      if (options.shouldRefreshPerson) {
        try {
          await options.refreshPerson(options.getPersonId(person));
        } catch (error) {
          options.logger.warn(
            `Failed to refresh ${options.serviceName} actor ${actorName} after photo sync: ${formatPersonSyncError(error)}`,
          );
        }
      }

      options.signalService.showLogText(`Updated ${options.serviceName} actor photo: ${actorName}`);
      return "processed";
    },
    onError: (person, error) => {
      const actorName = options.getPersonName(person).trim() || options.getPersonName(person);
      options.logger.warn(
        `Failed to update ${options.serviceName} actor photo for ${actorName}: ${formatPersonSyncError(error)}`,
      );
    },
  });

  options.signalService.showLogText(
    options.buildCompletionMessage?.(result, persons.length) ??
      `${options.serviceName} actor photo sync completed. Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
  );

  return result;
};
