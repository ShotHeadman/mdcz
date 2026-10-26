import type { ActorSyncJobDto } from "@mdcz/shared/serverDtos";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { toast } from "sonner";
import { getT, type Messages } from "../i18n";

const serverNames = (servers: ActorSyncJobDto["servers"]): string =>
  servers.map((server) => (server === "jellyfin" ? "Jellyfin" : "Emby")).join(" / ");

export const describeActorSync = (t: Messages, job: ActorSyncJobDto): string => {
  switch (job.status) {
    case "queued":
      return t.workbench.actorSyncQueued(serverNames(job.servers));
    case "waiting":
      return t.workbench.actorSyncWaiting(serverNames(job.servers), job.found, job.total);
    case "syncing":
      return t.workbench.actorSyncSyncing(serverNames(job.servers), job.synced + job.failed, job.total);
    case "completed":
      return t.workbench.actorSyncSummary(job.synced, job.notFound, job.failed);
    case "cancelled":
      return t.workbench.actorSyncCancelled;
  }
};

/** Stores a host's actor sync update and toasts when a sync this client watched completes. */
export const applyActorSyncJob = (job: ActorSyncJobDto): void => {
  const previous = useScrapeStore.getState().actorSyncs[job.runId];
  useScrapeStore.getState().setActorSync(job);
  if (job.status !== "completed" || !previous || previous.status === "completed") return;

  const t = getT();
  const summary = describeActorSync(t, job);
  const id = `actor-sync-${job.runId}`;
  if (job.scanMissed.length > 0) {
    toast.warning(summary, {
      id,
      description: t.workbench.actorSyncScanMissed(serverNames(job.scanMissed)),
    });
  } else if (job.notFound > 0 || job.failed > 0) toast.warning(summary, { id });
  else toast.success(summary, { id });
};
