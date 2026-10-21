import { getT } from "@mdcz/views/i18n";
import { selectScrapeSnapshot, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { ipc } from "@/client/ipc";

export const retryScrapeSelection = async (itemIds?: readonly string[]) => {
  const snapshot = selectScrapeSnapshot(useScrapeStore.getState());
  if (!snapshot) throw new Error(getT().desktop.noScrapeTaskToRetry);
  if (
    snapshot.task.status === "queued" ||
    snapshot.task.status === "running" ||
    snapshot.task.status === "paused" ||
    snapshot.task.status === "stopping"
  ) {
    throw new Error(getT().desktop.scrapeTaskInProgress);
  }
  return itemIds ? await ipc.scraper.retry(snapshot.task.id, itemIds) : await ipc.scraper.retry(snapshot.task.id);
};
