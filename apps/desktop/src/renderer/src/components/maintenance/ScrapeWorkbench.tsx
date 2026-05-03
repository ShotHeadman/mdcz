import { ScrapeWorkbenchFrame } from "@mdcz/views/workbench";
import { useShallow } from "zustand/react/shallow";
import { DetailPanel } from "@/components/DetailPanel";
import { ResultTree } from "@/components/ResultTree";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

export interface ScrapeWorkbenchProps {
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
}

export default function ScrapeWorkbench({
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
}: ScrapeWorkbenchProps) {
  const { isScraping, scrapeStatus, progress, resultsCount, reset } = useScrapeStore(
    useShallow((state) => ({
      isScraping: state.isScraping,
      scrapeStatus: state.scrapeStatus,
      progress: state.progress,
      resultsCount: state.results.length,
      reset: state.reset,
    })),
  );
  const setSelectedResultId = useUIStore((state) => state.setSelectedResultId);

  const handleReturnToSetup = () => {
    setSelectedResultId(null);
    reset();
  };

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTree />}
      detail={<DetailPanel />}
      isScraping={isScraping}
      scrapeStatus={scrapeStatus}
      progress={progress}
      showCompletedActions={!isScraping && resultsCount > 0}
      failedCount={failedCount}
      onPauseScrape={onPauseScrape}
      onResumeScrape={onResumeScrape}
      onStopScrape={onStopScrape}
      onRetryFailed={onRetryFailed}
      onReturnToSetup={handleReturnToSetup}
    />
  );
}
