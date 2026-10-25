import type { SiteUrlConfiguration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import {
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  type ScrapeResultGroup,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, copyText } from "@mdcz/ui";
import { selectScrapeResults, selectScrapeStatus, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { Copy, FileText, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmDialog, type MediaBrowserFilter, type MediaBrowserItem } from "../common";
import { getScrapeResultTitle, type ResultTreeManualUrlTarget, ResultTreeView } from "../detail";
import { type Messages, useT } from "../i18n";
import type { ScrapeActionPort } from "./ports";
import { activateNewScrapeTask } from "./workbenchSession";

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function buildMenuContent(
  t: Messages,
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
    try {
      await copyText(resultNumber);
      toast.success(t.scrape.numberCopied, { id: "clipboard" });
    } catch {
      toast.error(t.scrape.copyNumberFailed, { id: "clipboard" });
    }
  };

  const handleRetryScrape = async () => {
    try {
      await port.retryFailed([result.fileId]);
    } catch (error) {
      toast.error(toErrorMessage(error, t.scrape.rescrapeFailed), { id: "scrape-launch" });
    }
  };

  const handleRemove = async () => {
    const confirmed = await confirmDialog({
      title: t.scrape.removeFromLibrary,
      description:
        groupedVideoPaths.length > 1
          ? t.scrape.confirmRemoveGroup(groupedVideoPaths.length, resultNumber)
          : t.scrape.confirmRemoveSingle(resultPath),
      confirmLabel: t.common.remove,
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await port.removeRecord?.(groupedTargets);
    } catch (error) {
      toast.error(toErrorMessage(error, t.scrape.operationFailed), { id: "scrape-remove" });
    }
  };

  const runFileAction = (action: ((file: RootFileRef) => Promise<void>) | undefined, file: RootFileRef) =>
    void action?.(file).catch((error) => toast.error(toErrorMessage(error), { id: "file-action" }));

  const handleOpenNfo = () => {
    void port.openNfo(nfoPath);
  };

  const handleRescrapeByNumber = async () => {
    activateNewScrapeTask();
    try {
      await port.rescrape(groupedTargets, { unpin: true });
    } catch (error) {
      toast.error(toErrorMessage(error, t.scrape.rescrapeFailed), { id: "scrape-launch" });
    }
  };

  const handleManualUrlRescrape = () => {
    onManualUrlRescrape({
      videoPaths: groupedVideoPaths,
      targets: groupedTargets,
      number: resultNumber || t.scrape.unrecognizedNumber,
    });
  };

  return (
    <>
      <ContextMenuItem disabled={!resultNumber} onClick={handleCopyNumber}>
        {t.scrape.copyNumber}
        <ContextMenuShortcut>
          <Copy className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      {!canOpenFolder && (
        <ContextMenuItem
          onClick={async () => {
            try {
              await copyText(resultPath);
              toast.success(t.common.pathCopied, { id: "clipboard" });
            } catch (error) {
              toast.error(toErrorMessage(error, t.common.copyPathFailed), { id: "clipboard" });
            }
          }}
        >
          {t.scrape.copyPath}
          <ContextMenuShortcut>
            <Copy className="h-3.5 w-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRetryScrape}>{t.scrape.rescrape}</ContextMenuItem>
      <ContextMenuItem onClick={handleManualUrlRescrape}>
        {t.scrape.rescrapeByUrl}
        <ContextMenuShortcut>
          <Link2 className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleRescrapeByNumber}>{t.scrape.rescrapeByNumber}</ContextMenuItem>
      <ContextMenuSeparator />
      {port.removeRecord && (
        <ContextMenuItem onClick={handleRemove} className="text-destructive focus:text-destructive">
          {t.scrape.removeFromLibrary}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      {canOpenFolder ? (
        <ContextMenuItem onClick={() => runFileAction(port.openFolder, resultTarget.ref)}>
          {t.scrape.openSourceFolder}
          <ContextMenuShortcut>F</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {canOpenFolder && metadataRef && (
        <ContextMenuItem
          onClick={() => {
            runFileAction(port.openFolder, metadataRef);
          }}
        >
          {t.scrape.openMetadataFolder}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleOpenNfo}>
        {t.scrape.editNfo}
        <ContextMenuShortcut>
          <FileText className="h-3.5 w-3.5" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      {canPlay ? (
        <ContextMenuItem onClick={() => runFileAction(port.play, resultTarget.ref)}>
          {t.scrape.play}
          <ContextMenuShortcut>P</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function ResultTreeAdapter({
  port,
  siteUrls,
}: {
  port: ScrapeActionPort;
  siteUrls: SiteUrlConfiguration | undefined;
}) {
  const t = useT();
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
        title:
          group.display.crawlerData?.number ??
          (group.display.fileName.replace(/\.[^.]+$/u, "") || t.scrape.unrecognizedNumber),
        subtitle:
          getScrapeResultTitle(group.display) ||
          getFileNameFromPath(group.display.output?.relativePath ?? group.display.relativePath),
        errorText: group.errorText ?? group.display.error,
        status: scrapeStatus === "paused" && group.status === "queued" ? "paused" : group.status,
        onClick: () =>
          setSelectedResultId(
            group.items.find((item) => item.fileId === selectedResultId)?.fileId ?? group.representative.fileId,
          ),
        menuContent: buildMenuContent(t, group, selectedResultId, port, setManualUrlTarget),
      })),
    [port, resultGroups, scrapeStatus, selectedResultId, setSelectedResultId, t],
  );

  return (
    <ResultTreeView
      items={items}
      filter={filter}
      onFilterChange={setFilter}
      stats={[
        { label: t.scrape.metrics.total, value: String(resultGroups.length) },
        { label: t.scrape.metrics.success, value: String(successCount), tone: "positive" },
        { label: t.scrape.metrics.failed, value: String(failedCount), tone: "negative" },
      ]}
      manualUrlTarget={manualUrlTarget}
      siteUrls={siteUrls}
      scrapeStatus={scrapeStatus}
      onManualUrlDialogOpenChange={(open) => {
        if (!open) {
          setManualUrlTarget(null);
        }
      }}
      onManualUrlSubmit={async (target, manualUrl) => {
        activateNewScrapeTask();
        try {
          await port.rescrape(target.targets, { manualUrl });
        } catch (error) {
          toast.error(toErrorMessage(error, t.scrape.rescrapeByUrlFailed), { id: "scrape-launch" });
        }
      }}
    />
  );
}

export { ResultTreeAdapter as ResultTree };
