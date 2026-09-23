import { toErrorMessage } from "@mdcz/shared/error";
import {
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  type ScrapeResultGroup,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@mdcz/ui";
import { selectScrapeResults, selectScrapeStatus, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { Copy, FileText, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MediaBrowserFilter, MediaBrowserItem } from "../common";
import { getScrapeResultTitle, type ResultTreeManualUrlTarget, ResultTreeView } from "../detail";
import type { ScrapeActionPort } from "./ports";
import { activateNewScrapeTask } from "./workbenchSession";

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function buildMenuContent(
  group: ScrapeResultGroup,
  selectedResultId: string | null,
  port: ScrapeActionPort,
  onManualUrlRescrape: (target: ResultTreeManualUrlTarget) => void,
) {
  const actionContext = buildScrapeResultGroupActionContext(group, selectedResultId);
  const result = actionContext.selectedItem;
  const resultPath = result.output?.relativePath ?? result.relativePath;
  const resultNumber = result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, "");
  const nfoPath = actionContext.nfoPath ?? resultPath;
  const groupedTargets = actionContext.targets;
  const groupedVideoPaths = groupedTargets.map((target) => target.filePath);
  const resultTarget = {
    filePath: resultPath,
    ref: result.output ?? { rootId: result.rootId, relativePath: result.relativePath },
  };
  const canOpenFolder = typeof port.openFolder === "function";
  const metadataRef = result.nfo;
  const canPlay = typeof port.play === "function";

  const handleCopyNumber = async () => {
    if (!resultNumber) {
      toast.error("番号为空");
      return;
    }
    try {
      await navigator.clipboard.writeText(resultNumber);
      toast.success("已复制番号");
    } catch {
      toast.error("复制番号失败");
    }
  };

  const handleRetryScrape = async () => {
    try {
      const response = await port.retryFailed([result.fileId]);
      toast.success(response.message);
    } catch (error) {
      toast.error(toErrorMessage(error, "重新刮削失败"));
    }
  };

  const handleRemove = async () => {
    if (
      !window.confirm(
        groupedVideoPaths.length > 1
          ? `确定从媒体库移除 ${groupedVideoPaths.length} 项记录吗？\n${resultNumber}`
          : `确定从媒体库移除记录吗？\n${resultPath}`,
      )
    ) {
      return;
    }
    try {
      await port.removeRecord?.(groupedTargets);
      toast.success("已从媒体库移除，磁盘文件保持不变");
    } catch (error) {
      toast.error(toErrorMessage(error, "操作失败"));
    }
  };

  const handleOpenFolder = async () => {
    const filePath = resultPath.trim();
    if (!filePath) {
      toast.info("无可打开的文件路径");
      return;
    }

    try {
      await port.openFolder?.(resultTarget);
    } catch (error) {
      toast.error(`打开目录失败: ${toErrorMessage(error)}`);
    }
  };

  const handlePlay = () => void port.play?.(resultTarget);

  const handleOpenNfo = () => {
    void port.openNfo(nfoPath);
  };

  const handleManualUrlRescrape = () => {
    onManualUrlRescrape({
      videoPaths: groupedVideoPaths,
      targets: groupedTargets,
      number: resultNumber || "未识别番号",
    });
  };

  return (
    <>
      <ContextMenuItem onClick={handleCopyNumber}>
        复制番号
        <ContextMenuShortcut>
          <Copy className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      {!canOpenFolder && (
        <ContextMenuItem
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(resultPath);
              toast.success("已复制路径");
            } catch (error) {
              toast.error(toErrorMessage(error, "复制路径失败"));
            }
          }}
        >
          复制路径
          <ContextMenuShortcut>
            <Copy className="h-3.5 w-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRetryScrape}>重新刮削</ContextMenuItem>
      <ContextMenuItem onClick={handleManualUrlRescrape}>
        按 URL 重新刮削
        <ContextMenuShortcut>
          <Link2 className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      {port.removeRecord && (
        <ContextMenuItem onClick={handleRemove} className="text-destructive focus:text-destructive">
          从媒体库移除
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      {canOpenFolder ? (
        <ContextMenuItem onClick={handleOpenFolder}>
          打开源目录
          <ContextMenuShortcut>F</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {canOpenFolder && metadataRef && (
        <ContextMenuItem
          onClick={() => {
            void port.openFolder?.({ filePath: metadataRef.relativePath, ref: metadataRef });
          }}
        >
          打开元数据目录
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleOpenNfo}>
        编辑 NFO
        <ContextMenuShortcut>
          <FileText className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      {canPlay ? (
        <ContextMenuItem onClick={handlePlay}>
          播放
          <ContextMenuShortcut>P</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function ResultTreeAdapter({ port }: { port: ScrapeActionPort }) {
  const results = useScrapeStore(selectScrapeResults);
  const scrapeStatus = useScrapeStore(selectScrapeStatus);
  const { selectedResultId, setSelectedResultId } = useUIStore();
  const [filter, setFilter] = useState<MediaBrowserFilter>("all");
  const [manualUrlTarget, setManualUrlTarget] = useState<ResultTreeManualUrlTarget | null>(null);
  const resultGroups = useMemo(() => buildScrapeResultGroups(results), [results]);
  const successCount = useMemo(() => resultGroups.filter((group) => group.status === "success").length, [resultGroups]);
  const failedCount = useMemo(() => resultGroups.filter((group) => group.status === "failed").length, [resultGroups]);

  const items = useMemo<MediaBrowserItem[]>(
    () =>
      resultGroups.map((group) => ({
        id: group.id,
        active: group.items.some((item) => item.fileId === selectedResultId),
        title: group.display.crawlerData?.number ?? (group.display.fileName.replace(/\.[^.]+$/u, "") || "未识别番号"),
        subtitle:
          getScrapeResultTitle(group.display) ||
          getFileNameFromPath(group.display.output?.relativePath ?? group.display.relativePath),
        errorText: group.errorText ?? group.display.error,
        status:
          scrapeStatus === "paused" &&
          group.status === "processing" &&
          !group.items.some((item) => item.status === "processing")
            ? "paused"
            : group.status,
        onClick: () =>
          setSelectedResultId(
            group.items.find((item) => item.fileId === selectedResultId)?.fileId ?? group.representative.fileId,
          ),
        menuContent: buildMenuContent(group, selectedResultId, port, setManualUrlTarget),
      })),
    [port, resultGroups, scrapeStatus, selectedResultId, setSelectedResultId],
  );

  return (
    <ResultTreeView
      items={items}
      filter={filter}
      onFilterChange={setFilter}
      stats={[
        { label: "总计", value: String(resultGroups.length) },
        { label: "成功", value: String(successCount), tone: "positive" },
        { label: "失败", value: String(failedCount), tone: "negative" },
      ]}
      manualUrlTarget={manualUrlTarget}
      scrapeStatus={scrapeStatus}
      onManualUrlDialogOpenChange={(open) => {
        if (!open) {
          setManualUrlTarget(null);
        }
      }}
      onManualUrlSubmit={async (target, manualUrl) => {
        activateNewScrapeTask();
        try {
          const response = await port.rescrapeByUrl(target.targets, manualUrl);
          toast.success(response.message);
        } catch (error) {
          toast.error(toErrorMessage(error, "按 URL 重新刮削失败"));
        }
      }}
    />
  );
}

export { ResultTreeAdapter as ResultTree };
