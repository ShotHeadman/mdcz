import type { ActivityEntryDto, ActivityListResponse } from "@mdcz/shared/serverDtos";
import type { MaintenanceService } from "./maintenanceService";
import type { ScanQueueService } from "./scanQueueService";
import type { ScrapeService } from "./scrapeService";

/**
 * What the server has been doing, newest first: scans, scrape runs and the current maintenance session.
 * Finished scrape runs and scans are persisted; a maintenance session is listed only while it is the active one.
 */
export class ActivityService {
  constructor(
    private readonly deps: {
      scans: Pick<ScanQueueService, "list">;
      scrape: Pick<ScrapeService, "history" | "liveRuns">;
      maintenance: Pick<MaintenanceService, "automationTask">;
    },
  ) {}

  async list(limit = 20): Promise<ActivityListResponse> {
    const [scanTasks, scrapeHistory, liveRuns, maintenanceTask] = await Promise.all([
      this.deps.scans.list(),
      this.deps.scrape.history(),
      this.deps.scrape.liveRuns(),
      this.deps.maintenance.automationTask(),
    ]);
    const finishedRunIds = new Set(scrapeHistory.runs.map((run) => run.id));
    const entries: ActivityEntryDto[] = [
      ...liveRuns.runs
        .filter(({ task }) => !finishedRunIds.has(task.id))
        .map(({ task }) => ({
          id: task.id,
          kind: "scrape" as const,
          status: task.status,
          target: task.rootDisplayName || task.rootId,
          updatedAt: task.updatedAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          counts: { success: task.successCount, failed: task.failedCount, skipped: task.skippedCount },
          error: task.error,
        })),
      ...scanTasks.tasks.map((task) => ({
        id: task.id,
        kind: "scan" as const,
        status: task.status,
        target: task.rootDisplayName || task.rootId,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        counts: null,
        error: task.error,
      })),
      ...scrapeHistory.runs.map((run) => ({
        id: run.id,
        kind: "scrape" as const,
        status: run.disposition,
        target: run.rootDisplayName || run.rootId,
        updatedAt: run.completedAt ?? run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        counts: { success: run.successCount, failed: run.failedCount, skipped: run.skippedCount },
        error: run.error,
      })),
      ...(maintenanceTask
        ? [
            {
              id: maintenanceTask.id,
              kind: "maintenance" as const,
              status: maintenanceTask.status,
              target: maintenanceTask.rootDisplayName || maintenanceTask.rootId,
              updatedAt: maintenanceTask.updatedAt,
              startedAt: maintenanceTask.startedAt,
              completedAt: maintenanceTask.completedAt,
              counts: null,
              error: maintenanceTask.error,
            },
          ]
        : []),
    ];
    return { entries: entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit) };
  }
}
