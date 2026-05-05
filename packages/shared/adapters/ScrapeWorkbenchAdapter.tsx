import { ScrapeWorkbenchFrame } from "@mdcz/views/workbench";
import { useShallow } from "zustand/react/shallow";
import { useScrapeStore } from "../stores/scrapeStore";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import type { SharedWorkbenchPorts } from "./ports";
import { ResultTreeAdapter } from "./ResultTreeAdapter";
import { resetScrapeWorkbenchToSetup } from "./workbenchSession";

export interface ScrapeWorkbenchAdapterProps {
  ports: Pick<SharedWorkbenchPorts, "detail" | "scrape">;
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
}

export function ScrapeWorkbenchAdapter({
  ports,
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
}: ScrapeWorkbenchAdapterProps) {
  const { isScraping, scrapeStatus, progress, resultsCount } = useScrapeStore(
    useShallow((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      progress: state.progress,
      resultsCount: state.results.length,
    })),
  );

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTreeAdapter port={ports.scrape} />}
      detail={<DetailPanelAdapter port={ports.detail} />}
      isScraping={isScraping}
      scrapeStatus={scrapeStatus}
      progress={progress}
      showCompletedActions={!isScraping && resultsCount > 0}
      failedCount={failedCount}
      onPauseScrape={onPauseScrape}
      onResumeScrape={onResumeScrape}
      onStopScrape={onStopScrape}
      onRetryFailed={onRetryFailed}
      onReturnToSetup={resetScrapeWorkbenchToSetup}
    />
  );
}
