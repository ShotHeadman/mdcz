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
  const { isScraping, scrapeStatus, progress, resultsCount, stageMessage } = useScrapeStore(
    useShallow((state) => ({
      isScraping: selectIsScraping(state),
      scrapeStatus: selectScrapeStatus(state),
      progress: selectScrapeProgress(state),
      resultsCount: selectScrapeResults(state).length,
      stageMessage: state.snapshot?.latestStage?.message,
    })),
  );

  return (
    <ScrapeWorkbenchFrame
      list={<ResultTreeAdapter port={ports.scrape} />}
      detail={
        resultsCount === 0 && snapshot ? (
          <div className="space-y-4 p-8" role="status">
            <h2 className="text-lg font-semibold">
              {snapshot.task.status === "queued"
                ? "目录任务已排队"
                : snapshot.task.status === "discovering"
                  ? "正在发现视频文件"
                  : snapshot.task.status === "stopping"
                    ? "正在停止，等待活动文件操作退出"
                    : snapshot.task.status === "completed"
                      ? "未发现可处理视频"
                      : snapshot.task.status === "stopped"
                        ? "任务已停止"
                        : snapshot.task.status === "interrupted"
                          ? "任务已中断"
                          : (snapshot.task.error ?? stageMessage ?? "正在准备任务")}
            </h2>
            <p className="break-all text-sm">{snapshot.directorySource?.scanDir ?? snapshot.task.rootDisplayName}</p>
            {snapshot.discovery ? (
              <>
                <p>
                  已遍历 {snapshot.discovery.directories} 个目录，发现 {snapshot.discovery.candidates} 个视频，跳过{" "}
                  {snapshot.discovery.skipped} 项
                </p>
                <p className="break-all text-sm">{snapshot.discovery.currentPath}</p>
              </>
            ) : null}
            {snapshot.discovery?.warnings.length ? (
              <p className="break-all text-amber-600">部分路径无法访问：{snapshot.discovery.warnings.join("、")}</p>
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
        snapshot?.directorySource && ports.scrape.rerunDirectory
          ? () => {
              if (rerunning.current) return;
              rerunning.current = true;
              void ports.scrape
                .rerunDirectory?.(snapshot.task.id)
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
