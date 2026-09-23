import { buildUncensoredConfirmationItems } from "@mdcz/views/adapters/workbenchSession";
import { UncensoredConfirmDialog } from "@mdcz/views/scrape";
import { selectScrapeOutcome, selectScrapeSnapshot, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "../../client/ipc";

export default function ScrapeCompletionDialog() {
  const snapshot = useScrapeStore(selectScrapeSnapshot);
  const outcome = useScrapeStore(selectScrapeOutcome);
  const [dismissedCompletion, setDismissedCompletion] = useState<string | null>(null);

  if (!snapshot || !outcome || snapshot.ambiguousUncensoredItems.length === 0) return null;

  const completion = `${snapshot.task.id}:${snapshot.task.completedAt}`;
  if (dismissedCompletion === completion) return null;

  return (
    <UncensoredConfirmDialog
      key={completion}
      open
      items={snapshot.ambiguousUncensoredItems}
      onOpenChange={(open) => {
        if (!open) setDismissedCompletion(completion);
      }}
      onConfirm={async (selections) => {
        const result = await ipc.scraper.confirmUncensored({
          items: buildUncensoredConfirmationItems(snapshot.ambiguousUncensoredItems, selections),
        });
        toast.success(`已更新 ${result.updatedCount} 个文件的无码类型`);
      }}
    />
  );
}
