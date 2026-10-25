import { readFile } from "node:fs/promises";
import type { ActorSourceName } from "@mdcz/shared/actorSource";
import type { Configuration } from "@mdcz/shared/config";
import type { PersonSyncResult } from "@mdcz/shared/toolTypes";
import type { ActorProfile } from "@mdcz/shared/types";
import type { RuntimeNetworkClient } from "../network";
import type { RuntimeLogger } from "../shared";
import type { MediaServerItemDetail, MediaServerMode } from "./client";
import { toStringArray, toStringRecord, toStringValue } from "./common";
import { type PlannedPersonSyncState, planPersonSync } from "./planner";

export type PersonSyncOutcome = "processed" | "skipped" | "failed";

export interface MediaServerPerson {
  Id: string;
  Name: string;
  Overview?: string;
  ImageTags?: Record<string, string>;
}

export interface MediaServerSignalService {
  resetProgress(): void;
  setProgress(value: number, current?: number, total?: number): void;
  showLogText(message: string, level?: "info" | "warn" | "error"): void;
}

export interface MediaServerActorSourceProvider {
  lookup(
    configuration: Configuration,
    query: string | { name: string; requiredField?: "photo_url" },
  ): Promise<{
    profile: ActorProfile;
    warnings?: string[];
    sourceResults: ReadonlyArray<{ source: ActorSourceName; success: boolean }>;
  }>;
}

export interface MediaServerActorServiceDependencies {
  signalService: MediaServerSignalService;
  networkClient: RuntimeNetworkClient;
  actorSourceProvider: MediaServerActorSourceProvider;
  logger: RuntimeLogger;
}

/** What info and photo sync need from one server; method syntax keeps targets of either person type assignable. */
export interface MediaServerPersonTarget<TPerson extends MediaServerPerson = MediaServerPerson>
  extends MediaServerActorServiceDependencies {
  serviceName: "Jellyfin" | "Emby";
  configuration: Configuration;
  findPerson(name: string): Promise<TPerson | null>;
  fetchPersonDetail(person: TPerson): Promise<MediaServerItemDetail>;
  updatePersonInfo(person: TPerson, detail: MediaServerItemDetail, synced: PlannedPersonSyncState): Promise<void>;
  uploadPrimaryImage(personId: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deletePrimaryImage(personId: string): Promise<void>;
}

export type PersonSyncKind = "info" | "photo";

export interface PersonSyncScope {
  info?: MediaServerMode;
  photo?: MediaServerMode;
  /**
   * The person was just created from MDCz's own NFO, so everything on it came from the server's automatic name search
   * on TMDb/IMDb, which matches JAV actors to unrelated people. MDCz replaces all of it, provider IDs included, and
   * locks the person; a locked person is never searched again.
   */
  claim?: boolean;
}

export const formatPersonSyncError = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code === "string" && typeof message === "string") {
      return `${code}: ${message}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

/**
 * Picks the person a search returned under exactly this name, ignoring case like the servers do. `/Persons/{name}`
 * would look the name up directly, but Emby answers it with a 500 for a name it doesn't know.
 */
export const findPersonNamed = <TPerson extends MediaServerPerson>(
  persons: readonly TPerson[],
  name: string,
): TPerson | null => persons.find((person) => person.Name.toLowerCase() === name.toLowerCase()) ?? null;

export const hasMediaServerPrimaryImage = (person: Pick<MediaServerPerson, "ImageTags">): boolean =>
  typeof person.ImageTags?.Primary === "string" && person.ImageTags.Primary.trim().length > 0;

const imageContentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
};

/**
 * Syncs one person from a single actor-source lookup. There is no refresh afterwards: both servers show the write
 * at once, and on Emby a refresh is what starts its TMDb name search.
 */
export const syncMediaServerPerson = async <TPerson extends MediaServerPerson>(
  target: MediaServerPersonTarget<TPerson>,
  person: TPerson,
  scope: PersonSyncScope,
): Promise<PersonSyncOutcome> => {
  const name = person.Name.trim();
  let serverHasPhoto = hasMediaServerPrimaryImage(person);
  if (!name || (!scope.info && (!scope.photo || (scope.photo === "missing" && serverHasPhoto)))) return "skipped";

  let stage = "look up actor source";
  try {
    const actorSource = await target.actorSourceProvider.lookup(
      target.configuration,
      scope.info ? name : { name, requiredField: "photo_url" },
    );
    for (const warning of actorSource.warnings ?? []) {
      target.logger.warn(`Actor source warning for ${name}: ${warning}`);
    }

    let changed = false;
    if (scope.info) {
      stage = "read actor info";
      const fetched = await target.fetchPersonDetail(person);
      // Right after the server creates a person, its search results can still miss a photo it already saved.
      serverHasPhoto = hasMediaServerPrimaryImage({ ImageTags: toStringRecord(fetched.ImageTags) });
      const detail = scope.claim
        ? {
            ...fetched,
            Overview: undefined,
            PremiereDate: undefined,
            EndDate: undefined,
            ProductionYear: undefined,
            ProductionLocations: [],
            ProviderIds: {},
            LockData: true,
          }
        : fetched;
      const synced = planPersonSync(
        actorSource.profile,
        {
          overview: toStringValue(detail.Overview) ?? (scope.claim ? undefined : person.Overview),
          tags: toStringArray(detail.Tags),
          taglines: toStringArray(detail.Taglines),
          premiereDate: toStringValue(detail.PremiereDate),
          productionYear: typeof detail.ProductionYear === "number" ? detail.ProductionYear : undefined,
          productionLocations: toStringArray(detail.ProductionLocations),
        },
        scope.info,
        target.configuration.personSync.bioLabelLanguage,
      );
      if (synced.shouldUpdate || scope.claim) {
        stage = "write actor info";
        await target.updatePersonInfo(person, detail, synced);
        target.signalService.showLogText(`Updated ${target.serviceName} actor info: ${name}`);
        changed = true;
      }
    }

    if (scope.claim && serverHasPhoto) {
      // The server's photo came from the same name search, so MDCz's photo or none replaces it.
      stage = "remove photo";
      await target.deletePrimaryImage(person.Id);
      target.signalService.showLogText(`Removed the photo ${target.serviceName} found for actor ${name}`);
      serverHasPhoto = false;
      changed = true;
    }
    const source = actorSource.profile.photo_url?.trim();
    const wantsPhoto = scope.photo !== undefined && !(scope.photo === "missing" && serverHasPhoto);
    if (wantsPhoto && !source) {
      target.signalService.showLogText(`No ${target.serviceName} actor photo source found for ${name}`, "warn");
      const imageSources: readonly ActorSourceName[] = target.configuration.personSync.personImageSources;
      const failedSources = actorSource.sourceResults
        .filter((result) => !result.success && imageSources.includes(result.source))
        .map((result) => result.source);
      // The claimed person stays without a photo, which a missing-photo sync fills once these sources work again.
      if (scope.claim && failedSources.length > 0) {
        target.signalService.showLogText(
          `No photo for ${target.serviceName} actor ${name} because ${failedSources.join(", ")} failed`,
          "warn",
        );
        return "failed";
      }
    }
    if (wantsPhoto && source) {
      const remote = /^https?:\/\//iu.test(source);
      stage = remote ? "download photo" : "read local photo";
      if (!remote)
        target.signalService.showLogText(`Using local ${target.serviceName} actor photo for ${name}: ${source}`);
      const content = remote
        ? await target.networkClient.getContent?.(source, { headers: { accept: "image/*" } })
        : await readFile(source);
      if (content) {
        stage = "upload photo";
        await target.uploadPrimaryImage(person.Id, content, imageContentTypeFromPath(source));
        target.signalService.showLogText(`Updated ${target.serviceName} actor photo: ${name}`);
        changed = true;
      }
    }

    return changed ? "processed" : "skipped";
  } catch (error) {
    target.logger.warn(
      `Failed to sync ${target.serviceName} actor ${name} (${stage}): ${formatPersonSyncError(error)}`,
    );
    return "failed";
  }
};

export const runMediaServerPersonSync = async <TPerson extends MediaServerPerson>(
  target: MediaServerPersonTarget<TPerson>,
  scope: PersonSyncScope,
  persons: ReadonlyArray<TPerson>,
): Promise<PersonSyncResult> => {
  const result: PersonSyncResult = { processedCount: 0, failedCount: 0, skippedCount: 0 };
  if (persons.length === 0) {
    target.signalService.showLogText(`${target.serviceName} returned no actors to sync`, "warn");
    return result;
  }

  target.signalService.resetProgress();
  for (const [index, person] of persons.entries()) {
    const outcome = await syncMediaServerPerson(target, person, scope);
    if (outcome === "processed") result.processedCount += 1;
    else if (outcome === "failed") result.failedCount += 1;
    else result.skippedCount += 1;
    target.signalService.setProgress(Math.round(((index + 1) / persons.length) * 100), index + 1, persons.length);
  }

  target.signalService.showLogText(
    `${target.serviceName} actor ${scope.info ? "info" : "photo"} sync completed. Total: ${persons.length}, Success: ${result.processedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
  );
  return result;
};

/** Serializes every job that writes server person records: manual syncs and post-scrape follow-ups. */
export class PersonSyncLock {
  #tail: Promise<unknown> = Promise.resolve();
  #jobs = 0;

  get busy(): boolean {
    return this.#jobs > 0;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.#jobs += 1;
    const result = this.#tail.then(task).finally(() => {
      this.#jobs -= 1;
    });
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
