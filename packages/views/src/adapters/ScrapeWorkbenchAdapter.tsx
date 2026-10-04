import type { SiteUrlConfiguration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { TaskStatus } from "@mdcz/shared/serverDtos";
import {
  selectIsScraping,
  selectScrapeProgress,
  selectScrapeResults,
  selectScrapeStatus,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { CircleStop, Loader2, SearchX, TriangleAlert, Unplug } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { ScrapeWorkbenchFrame, type WorkbenchTaskStateContent, WorkbenchTaskStatePanel } from "../workbench";
import { DetailPanelAdapter } from "./DetailPanelAdapter";
import type { SharedWorkbenchPorts } from "./ports";
import { ResultTreeAdapter } from "./ResultTreeAdapter";
import { resetScrapeWorkbenchToSetup } from "./workbenchSession";

export interface ScrapeWorkbenchAdapterProps {
  ports: Pick<SharedWorkbenchPorts, "detail" | "scrape">;
  siteUrls: SiteUrlConfiguration | undefined;
  onPauseScrape: () => void;
  onResumeScrape: () => void;
  onStopScrape: () => void;
  onRetryFailed: () => void;
  failedCount: number;
}

export function ScrapeWorkbenchAdapter({
  ports,
  siteUrls,
  onPauseScrape,
  onResumeScrape,
  onStopScrape,
  onRetryFailed,
  failedCount,
}: ScrapeWorkbenchAdapterProps) {
  const rerunning = useRef(false);
  const snapshot = useScrapeStore((state) => state.snapshot);
  const t = useT();
  const { isScraping, scrapeStatus, progress, resultsCount, latestStage } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
      scrapeStatus: selectScrapeStatus(state),
      progress: selectScrapeProgress(state),
      resultsCount: selectScrapeResults(state).length,
      latestStage: state.snapshot?.latestStage,
    })),
  );
  const stageMessage = latestStage
    ? [t.scrape.stages[latestStage.stage], latestStage.relativePath?.split(/[\\/]/).at(-1)].filter(Boolean).join(" · ")
    : undefined;

  const emptyStates: Partial<Record<TaskStatus, WorkbenchTaskStateContent>> = {
    queued: { icon: Loader2, tone: "active", title: t.scrape.taskQueued },
    discovering: { icon: Loader2, tone: "active", title: t.scrape.scanningVideoFiles },
    stopping: { icon: Loader2, tone: "active", title: t.scrape.stoppingWaitingCurrent },
    completed: { icon: SearchX, tone: "muted", title: t.scrape.noVideosFound },
    stopped: { icon: CircleStop, tone: "muted", title: t.scrape.taskStopped },
    interrupted: {
      icon: Unplug,
      tone: "warning",
      title: t.scrape.taskInterrupted,
      hint: t.scrape.taskInterruptedHint,
    },
  };

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTreeAdapter port={ports.scrape} siteUrls={siteUrls} />}
      detail={
        resultsCount === 0 && snapshot ? (
          <WorkbenchTaskStatePanel
            {...(emptyStates[snapshot.task.status] ??
              (snapshot.task.error
                ? { icon: TriangleAlert, tone: "error", title: snapshot.task.error }
                : { icon: Loader2, tone: "active", title: stageMessage ?? t.scrape.preparingTask }))}
            path={snapshot.directorySource?.scanDir ?? snapshot.task.rootDisplayName}
            discovery={snapshot.discovery}
          />
        ) : (
          <DetailPanelAdapter port={ports.detail} />
        )
      }
      isScraping={isScraping}
      scrapeStatus={scrapeStatus}
      progress={snapshot?.progress.totalItems === null ? null : progress}
      canPause={resultsCount > 0}
      stageMessage={stageMessage}
      showCompletedActions={!isScraping && snapshot !== null}
      failedCount={failedCount}
      onPauseScrape={onPauseScrape}
      onResumeScrape={onResumeScrape}
      onStopScrape={onStopScrape}
      onRetryFailed={onRetryFailed}
      onRerunDirectory={
        snapshot?.directorySource
          ? () => {
              if (rerunning.current) return;
              rerunning.current = true;
              void ports.scrape
                .rerunDirectory(snapshot.task.id)
                .catch((error) => toast.error(toErrorMessage(error)))
                .finally(() => {
                  rerunning.current = false;
                });
            }
          : undefined
      }
      onReturnToSetup={resetScrapeWorkbenchToSetup}
    />
  );
}
