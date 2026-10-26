import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import type { Configuration } from "@mdcz/shared/config";
import type { ActorSyncJobDto } from "@mdcz/shared/serverDtos";
import { runWithNetworkSignal } from "../network";
import type { MediaServerKey } from "./client";
import { toStringRecord } from "./common";
import { createEmbyPersonTarget } from "./emby";
import { createJellyfinPersonTarget } from "./jellyfin";
import { notifiedMediaServers, refreshPublishedFolders } from "./libraryNotify";
import {
  formatPersonSyncError,
  type MediaServerActorServiceDependencies,
  type MediaServerPerson,
  type MediaServerPersonTarget,
  type PersonSyncLock,
  type PersonSyncOutcome,
  type PersonSyncScope,
  syncMediaServerPerson,
} from "./personSync";

// A refreshed folder yields its people within seconds; without a refresh the servers create them 60-90s after the
// last scan request. The deadline leaves room for large scans.
const RECHECK_INTERVAL_MS = 5_000;
const DEADLINE_MS = 5 * 60_000;
// Jellyfin looks a new person up on TMDb after its scan. A lookup already running when MDCz claims the person still
// saves its photo afterwards, about 15s later in practice. Lookups that start after the claim find no provider ID.
const CLAIM_VERIFY_DELAY_MS = 60_000;
// Actor lookups mostly wait on rate-limited sites, so a few run at once.
const SYNC_CONCURRENCY = 3;
const CLAIM: PersonSyncScope = { info: "all", photo: "all", claim: true };

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  setTimeout(ms, undefined, { signal }).catch((error: unknown) => {
    if (!signal.aborted) throw error;
  });

const isTerminal = (job: ActorSyncJobDto): boolean => job.status === "completed" || job.status === "cancelled";

interface PublishedRun {
  names: Set<string>;
  directories: Set<string>;
  configuration: Configuration;
  targets: Map<MediaServerKey, MediaServerPersonTarget>;
  /** Per server, whether each actor was missing when the run first published them, so this run creates them. */
  createdByRun: Map<MediaServerKey, Map<string, Promise<boolean>>>;
}

export interface ActorSyncFollowUpDependencies extends Omit<MediaServerActorServiceDependencies, "signalService"> {
  /** Shared with manual person syncs, which write the same records. */
  lock: PersonSyncLock;
  onChange(job: ActorSyncJobDto): void;
}

/**
 * Once a scrape run ends, syncs the actors it published. The server creates people only after it scans the published
 * folders, so MDCz asks it to scan them now and rechecks names it doesn't know yet until a deadline. People this run
 * created get MDCz's data in full and are locked; people the server already had only get what they miss.
 */
export class ActorSyncFollowUp {
  readonly #published = new Map<string, PublishedRun>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #jobs = new Map<string, ActorSyncJobDto>();
  readonly #serviceDeps: MediaServerActorServiceDependencies;
  #closed = false;

  constructor(private readonly deps: ActorSyncFollowUpDependencies) {
    this.#serviceDeps = {
      ...deps,
      signalService: {
        resetProgress: () => undefined,
        setProgress: () => undefined,
        showLogText: (message, level = "info") => deps.logger[level](message),
      },
    };
  }

  /** Running jobs and the newest one, which a client shows once it reconnects. */
  status(): ActorSyncJobDto[] {
    return [...this.#jobs.values()];
  }

  collect(
    runId: string,
    movie: { actors: readonly string[]; directories: readonly string[] },
    configuration: Configuration,
  ): void {
    const servers = configuration.personSync.syncAfterPublish ? notifiedMediaServers(configuration) : [];
    if (servers.length === 0) return;
    let published = this.#published.get(runId);
    if (!published) {
      published = {
        names: new Set(),
        directories: new Set(),
        configuration,
        targets: new Map(
          servers.map((server) => [
            server,
            server === "jellyfin"
              ? createJellyfinPersonTarget(this.#serviceDeps, configuration)
              : createEmbyPersonTarget(this.#serviceDeps, configuration),
          ]),
        ),
        createdByRun: new Map(servers.map((server) => [server, new Map()])),
      };
      this.#published.set(runId, published);
    }
    for (const actor of movie.actors) {
      const name = actor.trim();
      if (!name || published.names.has(name)) continue;
      published.names.add(name);
      for (const [server, target] of published.targets) {
        // Both servers scan a published folder 60-90s after hearing of it, so a person missing now is one this run
        // creates. Only MDCz's own observation decides this; the server's clock may differ from MDCz's.
        const missing = target.findPerson(name).then(
          (person) => person === null,
          (error) => {
            this.deps.logger.warn(
              `Could not check whether ${target.serviceName} already has actor ${name}; only filling in what it misses: ${formatPersonSyncError(error)}`,
            );
            return false;
          },
        );
        published.createdByRun.get(server)?.set(name, missing);
      }
    }
    for (const directory of movie.directories) published.directories.add(directory);
  }

  /** Syncs what the run published; settles once the follow-up completes or is cancelled. */
  async finish(runId: string): Promise<void> {
    const published = this.#published.get(runId);
    this.#published.delete(runId);
    if (!published?.names.size || this.#closed) return;
    const { configuration, targets, createdByRun } = published;
    const servers = [...targets.keys()];
    const names = [...published.names];
    const controller = new AbortController();
    const { signal } = controller;
    const cancelled = once(signal, "abort");
    const { lock, logger } = this.deps;
    this.#controllers.set(runId, controller);
    const job: ActorSyncJobDto = {
      runId,
      servers,
      status: "waiting",
      total: names.length * servers.length,
      found: 0,
      synced: 0,
      failed: 0,
      notFound: 0,
      scanMissed: [],
    };
    const publish = () => {
      const snapshot = { ...job, scanMissed: [...job.scanMissed] };
      this.#jobs.set(runId, snapshot);
      const newest = [...this.#jobs.keys()].at(-1);
      for (const [id, other] of this.#jobs) if (id !== newest && isTerminal(other)) this.#jobs.delete(id);
      this.deps.onChange(snapshot);
    };
    publish();
    const deadline = Date.now() + DEADLINE_MS;
    let syncing = 0;

    // Syncs one server's actors and returns its check of the claimed people, which runs after the job completes.
    const syncServer = async (server: MediaServerKey, target: MediaServerPersonTarget) => {
      const pending = new Set(names);
      const claims: Array<{
        name: string;
        person: MediaServerPerson;
        failed: boolean;
        imageTag?: string;
        verifyAt: number;
      }> = [];
      // Read from the person detail: search results lag behind what the server just saved.
      const readClaimedState = async (person: MediaServerPerson) => {
        const detail = await target.fetchPersonDetail(person);
        return {
          imageTag: toStringRecord(detail.ImageTags).Primary,
          hasProviderIds: Object.keys(toStringRecord(detail.ProviderIds)).length > 0,
        };
      };
      const syncPerson = async (name: string, person: MediaServerPerson) => {
        syncing += 1;
        job.status = "syncing";
        publish();
        let outcome: PersonSyncOutcome;
        try {
          if (await createdByRun.get(server)?.get(name)) {
            outcome = await syncMediaServerPerson(target, person, CLAIM);
            // Emby never looks a person up during a scan, only on a refresh, which MDCz never starts. Jellyfin's
            // lookup may still save what it found, whatever part of the claim failed.
            if (server === "jellyfin") {
              const { imageTag } = await readClaimedState(person);
              claims.push({
                name,
                person,
                failed: outcome === "failed",
                imageTag,
                verifyAt: Date.now() + CLAIM_VERIFY_DELAY_MS,
              });
            }
          } else {
            outcome = await syncMediaServerPerson(target, person, { info: "missing", photo: "missing" });
          }
        } catch (error) {
          logger.warn(`Failed to sync ${target.serviceName} actor ${name}: ${formatPersonSyncError(error)}`);
          outcome = "failed";
        }
        syncing -= 1;
        if (outcome === "failed") job.failed += 1;
        else job.synced += 1;
        job.status = syncing > 0 ? "syncing" : "waiting";
        publish();
      };
      // Writes share the lock with manual syncs; a job cancelled while it waits for the lock stops at once.
      const syncFound = async (found: Array<[string, MediaServerPerson]>) => {
        if (lock.busy && syncing === 0) {
          job.status = "queued";
          publish();
        }
        let syncs: Promise<unknown> | undefined;
        await Promise.race([
          lock.run(async () => {
            if (signal.aborted) return;
            syncs = Promise.all(
              Array.from({ length: SYNC_CONCURRENCY }, async () => {
                for (let next = found.shift(); next && !signal.aborted; next = found.shift()) await syncPerson(...next);
              }),
            );
            await syncs;
          }),
          cancelled,
        ]);
        await syncs;
      };
      // Runs outside the lock, so manual syncs need not wait for the delay; only a repeated claim takes it.
      const verifyClaims = async () => {
        try {
          for (const claim of claims) {
            await sleep(Math.max(0, claim.verifyAt - Date.now()), signal);
            if (signal.aborted) return;
            const current = await readClaimedState(claim.person);
            if (current.imageTag === claim.imageTag && !current.hasProviderIds) continue;
            logger.warn(`${target.serviceName} changed actor ${claim.name} while MDCz claimed it; claiming it again`);
            // Only a lookup already running at the first claim can undo it, so a repeated claim needs no check.
            const failed = (await lock.run(() => syncMediaServerPerson(target, claim.person, CLAIM))) === "failed";
            if (failed === claim.failed) continue;
            job.synced += failed ? -1 : 1;
            job.failed += failed ? 1 : -1;
            publish();
          }
        } catch (error) {
          logger.error(`Checking claimed actors on ${target.serviceName} failed: ${formatPersonSyncError(error)}`);
        }
      };

      // Cancelling ends the requests that wait on the server at once. A write already under way still finishes, so no
      // claim is left locked with the server's photo.
      try {
        const refreshed = await runWithNetworkSignal(signal, () =>
          refreshPublishedFolders(this.deps.networkClient, configuration, server, [...published.directories]),
        );
        if (refreshed === 0)
          logger.warn(
            `No ${target.serviceName} library holds the published folders, so it may see them under other paths; waiting for its own scan`,
          );
      } catch (error) {
        if (!signal.aborted)
          logger.warn(
            `Could not ask ${target.serviceName} to scan the published folders now; waiting for its own scan: ${formatPersonSyncError(error)}`,
          );
      }

      let missingAtFirstCheck: number | undefined;
      let searchError: unknown;
      while (!signal.aborted) {
        // Decided before the check, so actors that appeared while it waited for the lock are searched once more.
        const lastCheck = Date.now() >= deadline;
        const found: Array<[string, MediaServerPerson]> = [];
        searchError = undefined;
        for (const name of pending) {
          try {
            const person = await runWithNetworkSignal(signal, () => target.findPerson(name));
            if (person) found.push([name, person]);
          } catch (error) {
            // Searches fail most while the server scans; the next check retries them.
            searchError = error;
            break;
          }
        }
        for (const [name] of found) pending.delete(name);
        job.found += found.length;
        missingAtFirstCheck ??= pending.size;
        if (found.length > 0) await syncFound(found);
        if (pending.size === 0 || lastCheck) break;
        await sleep(RECHECK_INTERVAL_MS, signal);
      }
      if (signal.aborted || pending.size === 0) return verifyClaims;
      const missing = [...pending].join(", ");
      if (searchError) {
        job.failed += pending.size;
        logger.error(
          `Could not search ${target.serviceName} for these actors, so they were not synced: ${missing}: ${formatPersonSyncError(searchError)}`,
        );
      } else {
        job.notFound += pending.size;
        if (pending.size === missingAtFirstCheck) job.scanMissed.push(server);
        logger.warn(`${target.serviceName} did not create these actors in time, so they were not synced: ${missing}`);
      }
      return verifyClaims;
    };

    try {
      const verifications = await Promise.all([...targets].map(([server, target]) => syncServer(server, target)));
      job.status = signal.aborted ? "cancelled" : "completed";
      publish();
      logger.info(
        `Actor sync after scrape ${runId} ${job.status}. Synced: ${job.synced}, Not found: ${job.notFound}, Failed: ${job.failed}`,
      );
      await Promise.all(verifications.map((verify) => verify()));
    } finally {
      this.#controllers.delete(runId);
    }
  }

  cancel(runId: string): void {
    this.#controllers.get(runId)?.abort();
  }

  close(): void {
    this.#closed = true;
    for (const controller of this.#controllers.values()) controller.abort();
  }
}
