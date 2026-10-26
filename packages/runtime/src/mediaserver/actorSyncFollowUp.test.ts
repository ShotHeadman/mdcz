import { defaultConfiguration } from "@mdcz/shared/config";
import type { ActorSyncJobDto } from "@mdcz/shared/serverDtos";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNetworkSignal, type RuntimeNetworkClient } from "../network";
import { noopRuntimeLogger } from "../shared";
import { ActorSyncFollowUp } from "./actorSyncFollowUp";
import { PersonSyncLock } from "./personSync";

// Fake timers patch timers/promises for CommonJS callers only, so the follow-up's waits run on the faked global timer.
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number, value: unknown, { signal }: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(() => resolve(value), ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    }),
}));

const USER_ID = "123e4567-e89b-12d3-a456-426614174000";
const configuration = {
  ...defaultConfiguration,
  jellyfin: {
    ...defaultConfiguration.jellyfin,
    url: "http://jellyfin.test",
    apiKey: "token",
    userId: USER_ID,
  },
  personSync: { ...defaultConfiguration.personSync, syncAfterPublish: true },
};

const MINUTE = 60_000;

describe("ActorSyncFollowUp", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    {
      name: "fills in actors the server already had without waiting, published straight into the library root",
      actors: ["Actor A", " Actor A ", "Actor B"],
      directories: ["/media/output"],
      existing: ["Actor A", "Actor B"],
      expected: { status: "completed", total: 2, found: 2, synced: 2, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A", "Actor B"],
      claimed: [],
    },
    {
      name: "rechecks until late actors appear and claims them, removing the server's photo even while a photo source fails",
      actors: ["Actor A", "Actor B", "Actor C"],
      existing: ["Actor A"],
      appearsAfterMs: { "Actor B": 1.5 * MINUTE, "Actor C": 1.5 * MINUTE },
      noPhoto: ["Actor B", "Actor C"],
      photoSourceFails: ["Actor C"],
      expected: { status: "completed", total: 3, found: 3, synced: 2, failed: 1, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A", "Actor B", "Actor C"],
      claimed: ["Actor B", "Actor C"],
    },
    {
      name: "retries searches that fail while the server scans",
      actors: ["Actor A", "Actor B"],
      failingSearches: 3,
      expected: { status: "completed", total: 2, found: 2, synced: 2, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A", "Actor B"],
      claimed: ["Actor A", "Actor B"],
    },
    {
      name: "gives up on actors still missing at the deadline, leaving manual syncs free meanwhile",
      actors: ["Actor A", "Actor B"],
      existing: ["Actor A"],
      appearsAfterMs: { "Actor B": Number.POSITIVE_INFINITY },
      manualSync: { atMs: MINUTE, forMs: 0 },
      expected: { status: "completed", total: 2, found: 1, synced: 1, notFound: 1, scanMissed: ["jellyfin"] },
      lookedUp: ["Actor A", "Actor B"],
      claimed: [],
    },
    {
      name: "stops rechecking when cancelled",
      actors: ["Actor A"],
      appearsAfterMs: { "Actor A": Number.POSITIVE_INFINITY },
      cancelAfterMs: 0.5 * MINUTE,
      expected: { status: "cancelled", total: 1, found: 0, synced: 0, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A"],
      claimed: [],
    },
    {
      name: "cancels at once while a search hangs on the server",
      actors: ["Actor A"],
      searchesHang: true,
      cancelAfterMs: 0.5 * MINUTE,
      expected: { status: "cancelled", total: 1, found: 0, synced: 0, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A"],
      claimed: [],
    },
    {
      name: "queues writes behind a manual sync and cancels at once while queued",
      actors: ["Actor A"],
      existing: ["Actor A"],
      manualSync: { atMs: 0, forMs: 10 * MINUTE },
      cancelAfterMs: 0.5 * MINUTE,
      expected: { status: "cancelled", total: 1, found: 1, synced: 0, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A"],
      claimed: [],
    },
    {
      name: "claims an actor again when the server saves its own photo after the claim, without holding the lock",
      actors: ["Actor A"],
      photoAfterClaim: ["Actor A"],
      expected: { status: "completed", total: 1, found: 1, synced: 1, notFound: 0, scanMissed: [] },
      lookedUp: ["Actor A"],
      claimed: ["Actor A"],
    },
  ])("$name", async ({
    actors,
    directories = ["/media/output/MOVIE-1"],
    existing = [],
    appearsAfterMs = {},
    noPhoto = [],
    photoSourceFails = [],
    photoAfterClaim = [],
    failingSearches = 0,
    searchesHang = false,
    manualSync,
    cancelAfterMs,
    expected,
    lookedUp,
    claimed,
  }) => {
    let refreshedAt: number | undefined;
    const lookups: string[] = [];
    let searchFailuresLeft = failingSearches;
    const writes: Array<{ method: string; path: string; body?: string }> = [];
    const photoTags = new Map(noPhoto.map((name) => [name, "server-found"]));
    const locked = new Set<string>();
    const detailReadsSinceClaim = new Map<string, number>();
    const networkClient = {
      getJson: vi.fn(async (url: string) => {
        const { pathname: path, searchParams } = new URL(url);
        const name = searchParams.get("searchTerm");
        if (path === "/Persons" && name) {
          lookups.push(name);
          if (refreshedAt !== undefined && searchesHang) {
            const signal = getNetworkSignal();
            return await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
          }
          if (refreshedAt !== undefined && searchFailuresLeft > 0) {
            searchFailuresLeft -= 1;
            throw new Error("Jellyfin is busy scanning");
          }
          // The search also matches longer names; only the exact one is the actor.
          const similar = { Id: `id-${name}-similar`, Name: `${name} Similar`, ImageTags: {} };
          const isExisting = (existing as string[]).includes(name);
          // The run's own actors appear once the server scans the folder MDCz asked it to refresh.
          const appearsAfter = (appearsAfterMs as Record<string, number>)[name] ?? 0;
          if (!isExisting && (refreshedAt === undefined || Date.now() - refreshedAt < appearsAfter))
            return { Items: [similar] };
          return {
            Items: [
              similar,
              {
                Id: `id-${name}`,
                Name: name.toLowerCase(),
                // Search results for a person the server just created still miss the photo it saved.
                ImageTags: isExisting && photoTags.has(name) ? { Primary: photoTags.get(name) } : {},
              },
            ],
          };
        }
        if (path === "/Library/VirtualFolders") return [{ ItemId: "library", Locations: ["/media/output/"] }];
        if (path === "/Items" && searchParams.get("ParentId") === "library") return { Items: [] };
        if (path.startsWith(`/Users/${USER_ID}/Items/id-`)) {
          const id = decodeURI(path).slice(`/Users/${USER_ID}/Items/id-`.length);
          const reads = detailReadsSinceClaim.get(id);
          if (reads !== undefined) detailReadsSinceClaim.set(id, reads + 1);
          // The server's own lookup was already running at the claim and saves its photo after MDCz read it back.
          if (reads === 1 && photoAfterClaim.includes(id)) photoTags.set(id, "server-late");
          // What the server's own TMDb name search left on the person.
          return {
            LockedFields: [],
            LockData: locked.has(id),
            ProviderIds: locked.has(id) ? {} : { Tmdb: "1" },
            Overview: "TMDb bio",
            ImageTags: photoTags.has(id) ? { Primary: photoTags.get(id) } : {},
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      }),
      getContent: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
      postText: vi.fn(async (url: string, body: string) => {
        const path = decodeURI(new URL(url).pathname);
        writes.push({ method: "POST", path, body });
        if (path === "/Items/library/Refresh") refreshedAt ??= Date.now();
        const [, id, image] = path.match(/^\/Items\/id-(.+?)(\/Images\/Primary)?$/u) ?? [];
        if (image) photoTags.set(id, `mdcz-${writes.length}`);
        else if (id && JSON.parse(body).LockData) {
          locked.add(id);
          detailReadsSinceClaim.set(id, 0);
        }
        return "";
      }),
      deleteText: vi.fn(async (url: string) => {
        const path = decodeURI(new URL(url).pathname);
        writes.push({ method: "DELETE", path });
        photoTags.delete(path.match(/^\/Items\/id-(.+?)\//u)?.[1] ?? "");
        return "";
      }),
    } as unknown as RuntimeNetworkClient;
    const jobs: ActorSyncJobDto[] = [];
    const lock = new PersonSyncLock();
    let writesWhenCompleted: number | undefined;
    let writesWhenLockFree: number | undefined;
    let manualSyncWaitedMs: number | undefined;
    let settledAfterMs = 0;
    const followUp = new ActorSyncFollowUp({
      networkClient,
      actorSourceProvider: {
        lookup: async (_configuration, query) => {
          const name = typeof query === "string" ? query : query.name;
          // Looked up by the name the server returned, which differs in case from the published one.
          const matches = (actors: string[]) => actors.some((actor) => actor.toLowerCase() === name.toLowerCase());
          return {
            profile: {
              name,
              description: "Biography",
              photo_url: matches(noPhoto) ? undefined : "https://images.test/actor.jpg",
            },
            sourceResults: [{ source: "gfriends", success: !matches(photoSourceFails) }],
          };
        },
      },
      logger: noopRuntimeLogger,
      lock,
      onChange: (job) => {
        jobs.push(job);
        if (job.status !== "completed" || writesWhenCompleted !== undefined) return;
        writesWhenCompleted = writes.length;
        void lock.run(async () => {
          writesWhenLockFree = writes.length;
        });
      },
    });

    followUp.collect("run-1", { actors, directories }, configuration);
    let settled = false;
    const startedAt = Date.now();
    const finished = followUp.finish("run-1").finally(() => {
      settled = true;
      settledAfterMs = Date.now() - startedAt;
    });
    for (let elapsed = 0; !settled && elapsed < 10 * MINUTE; elapsed += 1000) {
      if (elapsed === cancelAfterMs) followUp.cancel("run-1");
      if (elapsed === manualSync?.atMs) {
        const manualSyncStartedAt = Date.now();
        void lock.run(async () => {
          manualSyncWaitedMs = Date.now() - manualSyncStartedAt;
          await new Promise((resolve) => setTimeout(resolve, manualSync.forMs));
        });
      }
      await vi.advanceTimersByTimeAsync(1000);
    }
    await finished;

    expect(jobs[0]?.status).toBe("waiting");
    if (cancelAfterMs !== undefined) expect(settledAfterMs).toBeLessThanOrEqual(cancelAfterMs + 1000);
    // Finding actors never holds the lock; only writes wait for it, and only behind another job.
    if (manualSync) expect(manualSyncWaitedMs).toBe(0);
    expect(jobs.some(({ status }) => status === "queued")).toBe(Boolean(manualSync?.forMs));
    expect(followUp.status()).toEqual([
      expect.objectContaining({ runId: "run-1", servers: ["jellyfin"], failed: 0, ...expected }),
    ]);
    expect([...new Set(lookups)]).toEqual(lookedUp);
    // The library folder is scanned at once; people are never refreshed, which would search TMDb for them.
    expect(writes.filter(({ path }) => path.endsWith("/Refresh")).map(({ path }) => path)).toEqual([
      "/Items/library/Refresh",
    ]);
    for (const name of lookedUp.slice(0, expected.synced + (expected.failed ?? 0))) {
      const update = writes.find(({ method, path }) => method === "POST" && path === `/Items/id-${name}`);
      const photo = writes.find(({ path }) => path === `/Items/id-${name}/Images/Primary`);
      if (!(claimed as string[]).includes(name)) {
        expect(update ? JSON.parse(update.body ?? "{}") : {}).not.toMatchObject({ LockData: true });
        expect(photo?.method).toBe("POST");
        continue;
      }
      const claims = writes.filter(
        ({ method, path, body }) =>
          method === "POST" && path === `/Items/id-${name}` && JSON.parse(body ?? "{}").LockData,
      );
      expect(claims).toHaveLength(photoAfterClaim.includes(name) ? 2 : 1);
      expect(JSON.parse(update?.body ?? "{}")).toMatchObject({
        LockData: true,
        ProviderIds: {},
        Overview: expect.stringContaining("Biography"),
      });
      if (photoAfterClaim.includes(name)) {
        // The delayed check runs after the job reports completion and lets other syncs take the lock meanwhile.
        const reclaim = writes.indexOf(claims[1]);
        expect(reclaim).toBeGreaterThanOrEqual(writesWhenCompleted ?? Number.POSITIVE_INFINITY);
        expect(writesWhenLockFree).toBeLessThanOrEqual(reclaim);
      }
      // The server's photo is removed even when no photo source works, so a missing-photo sync can fill it later.
      expect(photo?.method).toBe(noPhoto.includes(name) ? "DELETE" : "POST");
    }
  });
});
