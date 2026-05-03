import type { Configuration } from "@mdcz/shared/config";
import type { PersonSyncResult } from "@mdcz/shared/ipcTypes";
import type { MediaServerMode } from ".";
import { createEmptyPersonSyncResult, formatPersonSyncError, runPersonSyncBatch } from "./personSync";
import {
  type ExistingPersonSyncState,
  normalizeExistingPersonSyncState,
  type PlannedPersonSyncState,
  planPersonSync,
} from "./planner";

interface MediaServerInfoSyncLogger {
  warn(message: string): void;
}

export interface RuntimeInfoActorSourceProvider {
  lookup(
    configuration: Configuration,
    query: string | { name: string; requiredField?: "photo_url" | "description" },
  ): Promise<{
    profile: Parameters<typeof planPersonSync>[0];
    warnings?: string[];
  }>;
}

const logActorSourceWarnings = (
  logger: MediaServerInfoSyncLogger,
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

interface MediaServerInfoSyncOptions<TPerson, TDetail> {
  configuration: Configuration;
  mode: MediaServerMode;
  serviceName: string;
  signalService: ProgressSignalService;
  actorSourceProvider: RuntimeInfoActorSourceProvider;
  logger: MediaServerInfoSyncLogger;
  fetchPersons: () => Promise<ReadonlyArray<TPerson>>;
  getPersonName: (person: TPerson) => string;
  getPersonId: (person: TPerson) => string;
  fetchPersonDetail: (person: TPerson) => Promise<TDetail>;
  buildExistingState: (person: TPerson, detail: TDetail) => ExistingPersonSyncState;
  updatePersonInfo: (person: TPerson, detail: TDetail, synced: PlannedPersonSyncState) => Promise<void>;
  shouldRefreshPerson: boolean;
  refreshPerson: (personId: string) => Promise<void>;
  actorLookupQuery?: (person: TPerson) => string | { name: string };
  buildCompletionMessage?: (result: PersonSyncResult, total: number) => string;
}

export const runMediaServerInfoSync = async <TPerson, TDetail>(
  options: MediaServerInfoSyncOptions<TPerson, TDetail>,
): Promise<PersonSyncResult> => {
  const persons = await options.fetchPersons();
  if (persons.length === 0) {
    return createEmptyPersonSyncResult();
  }

  const result = await runPersonSyncBatch({
    items: persons,
    signalService: options.signalService,
    processItem: async (person) => {
      const detail = await options.fetchPersonDetail(person);
      const existing = normalizeExistingPersonSyncState(options.buildExistingState(person, detail));
      const personName = options.getPersonName(person);
      const actorSource = await options.actorSourceProvider.lookup(
        options.configuration,
        options.actorLookupQuery?.(person) ?? personName,
      );
      logActorSourceWarnings(options.logger, personName, actorSource.warnings);

      const synced = planPersonSync(actorSource.profile, existing, options.mode);
      if (!synced.shouldUpdate) {
        return "skipped";
      }

      await options.updatePersonInfo(person, detail, synced);
      if (options.shouldRefreshPerson) {
        try {
          await options.refreshPerson(options.getPersonId(person));
        } catch (error) {
          options.logger.warn(
            `Failed to refresh ${options.serviceName} actor ${personName} after info sync: ${formatPersonSyncError(error)}`,
          );
        }
      }

      options.signalService.showLogText(`Updated ${options.serviceName} actor info: ${personName}`);
      return "processed";
    },
    onError: (person, error) => {
      options.logger.warn(
        `Failed to update ${options.serviceName} actor info for ${options.getPersonName(person)}: ${formatPersonSyncError(error)}`,
      );
    },
  });

  options.signalService.showLogText(
    options.buildCompletionMessage?.(result, persons.length) ??
      `${options.serviceName} actor info sync completed. Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
  );

  return result;
};
