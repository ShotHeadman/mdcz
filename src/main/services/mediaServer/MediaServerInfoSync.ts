import type { ActorSourceProvider } from "@main/services/actorSource";
import { logActorSourceWarnings, type WarningLogger } from "@main/services/actorSource/logging";
import {
  createEmptyPersonSyncResult,
  formatPersonSyncError,
  runPersonSyncBatch,
} from "@main/services/common/personSync";
import type { Configuration } from "@main/services/config";
import {
  type ExistingPersonSyncState,
  normalizeExistingPersonSyncState,
  type PlannedPersonSyncState,
  planPersonSync,
} from "@main/services/personSync/planner";
import type { SignalService } from "@main/services/SignalService";
import type { PersonSyncResult } from "@shared/ipcTypes";
import type { MediaServerMode } from "./MediaServerClient";

interface ProgressSignalService extends Pick<SignalService, "resetProgress" | "setProgress" | "showLogText"> {}

interface MediaServerInfoSyncOptions<TPerson, TDetail> {
  configuration: Configuration;
  mode: MediaServerMode;
  serviceName: string;
  signalService: ProgressSignalService;
  actorSourceProvider: ActorSourceProvider;
  logger: WarningLogger;
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
