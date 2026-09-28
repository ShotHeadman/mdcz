import { toErrorMessage } from "@mdcz/shared/error";
import {
  selectIsScraping,
  selectScrapeProgress,
  selectScrapeResults,
  selectScrapeStatus,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useRef } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { ScrapeWorkbenchFrame } from "../workbench";
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

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTreeAdapter port={ports.scrape} />}
      detail={
        resultsCount === 0 && snapshot ? (
          <div className="space-y-4 p-8" role="status">
            <h2 className="text-lg font-semibold">
              {snapshot.task.status === "queued"
                ? t.scrape.taskQueued
                : snapshot.task.status === "discovering"
                  ? t.scrape.scanningVideoFiles
                  : snapshot.task.status === "stopping"
                    ? t.scrape.stoppingWaitingCurrent
                    : snapshot.task.status === "completed"
                      ? t.scrape.noVideosFound
                      : snapshot.task.status === "stopped"
                        ? t.scrape.taskStopped
                        : snapshot.task.status === "interrupted"
                          ? t.scrape.taskInterrupted
                          : (snapshot.task.error ?? stageMessage ?? t.scrape.preparingTask)}
            </h2>
            <p className="break-all text-sm">{snapshot.directorySource?.scanDir ?? snapshot.task.rootDisplayName}</p>
            {snapshot.discovery ? (
              <>
                <p>
                  {t.scrape.discoveryStatus(
                    snapshot.discovery.directories,
                    snapshot.discovery.candidates,
                    snapshot.discovery.skipped,
                  )}
                </p>
                <p className="break-all text-sm">{snapshot.discovery.currentPath}</p>
              </>
            ) : null}
            {snapshot.discovery?.warnings.length ? (
              <p className="break-all text-amber-600">{t.scrape.warnings(snapshot.discovery.warnings)}</p>
            ) : null}
          </div>
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
