import { describe, expect, it } from "vitest";
import { ActivityService } from "./activityService";

const scrapeRun = (id: string, completedAt: string) => ({
  id,
  rootDisplayName: "Downloads",
  disposition: "completed" as const,
  createdAt: completedAt,
  startedAt: new Date(Date.parse(completedAt) - 12_000).toISOString(),
  completedAt,
  successCount: 3,
  failedCount: 1,
  skippedCount: 0,
  error: null,
});

describe("ActivityService", () => {
  it("lists scans, scrape runs and the active maintenance session newest first, once per run", async () => {
    const service = new ActivityService({
      scans: {
        list: async () =>
          ({
            tasks: [
              {
                id: "scan-1",
                rootId: "root",
                rootDisplayName: "Library",
                status: "completed",
                updatedAt: "2026-10-08T09:00:00.000Z",
                startedAt: null,
                completedAt: null,
                error: null,
              },
            ],
          }) as never,
      },
      scrape: {
        history: async () =>
          ({
            runs: [
              scrapeRun("run-done", "2026-10-08T10:00:00.000Z"),
              { ...scrapeRun("run-live", "2026-10-08T11:00:00.000Z"), disposition: "interrupted", completedAt: null },
            ],
            results: [],
          }) as never,
        liveRuns: async () =>
          ({
            runs: [
              {
                task: {
                  ...scrapeRun("run-done", "2026-10-08T10:00:00.000Z"),
                  status: "completed",
                  updatedAt: "2026-10-08T10:00:00.000Z",
                },
              },
              {
                task: {
                  ...scrapeRun("run-live", "2026-10-08T11:00:00.000Z"),
                  status: "running",
                  rootId: "root",
                  updatedAt: "2026-10-08T11:00:00.000Z",
                  completedAt: null,
                },
              },
            ],
          }) as never,
      },
      maintenance: {
        automationTask: async () =>
          ({
            id: "session-1",
            rootId: "root",
            rootDisplayName: "",
            status: "paused",
            startedAt: null,
            completedAt: null,
            durationMs: null,
            error: null,
            updatedAt: "2026-10-08T08:00:00.000Z",
          }) as never,
      },
    });

    const { entries } = await service.list(3);

    expect(entries.map(({ id, kind, status }) => ({ id, kind, status }))).toEqual([
      { id: "run-live", kind: "scrape", status: "running" },
      { id: "run-done", kind: "scrape", status: "completed" },
      { id: "scan-1", kind: "scan", status: "completed" },
    ]);
    expect(entries[1]?.counts).toEqual({ success: 3, failed: 1, skipped: 0 });
    expect(entries.map((entry) => entry.durationMs)).toEqual([null, 12_000, null]);
  });
});
