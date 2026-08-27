import path from "node:path";
import type {
  AmbiguousUncensoredItemDto,
  LogEntryDto,
  ScrapeLiveItemDto,
  ScrapeRunSnapshotDto,
} from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import type { ScrapeRunItemSnapshot, ScrapeRunSnapshot } from "./ScrapeRunSession";

export interface ScrapeSnapshotManifest {
  id: string;
  rootId: string;
  createdAt: Date;
  items: Array<{ id: string; rootId: string; relativePath: string; manualUrl?: string | null }>;
}

const isTerminalStatus = (status: ScrapeRunSnapshot["status"]): boolean =>
  status === "completed" || status === "failed" || status === "stopped";

const liveItemToDto = (manifest: ScrapeSnapshotManifest, item: ScrapeRunItemSnapshot): ScrapeLiveItemDto => {
  const manifestItem = manifest.items.find((candidate) => candidate.id === item.id);
  if (!manifestItem) throw new Error(`Scrape item not found in manifest: ${item.id}`);
  const result = item.result;
  return {
    id: item.id,
    resultId: result?.resultId ?? null,
    rootId: item.rootId,
    relativePath: item.relativePath,
    fileName: path.posix.basename(item.relativePath),
    status: item.status,
    error: item.error,
    crawlerData: result?.crawlerData ?? null,
    nfoRootId: result?.nfo?.rootId ?? null,
    nfoRelativePath: result?.nfo?.relativePath ?? null,
    outputRootId: result?.output?.rootId ?? null,
    outputRelativePath: result?.output?.relativePath ?? null,
    assets: result?.assets ?? [],
    manualUrl: manifestItem.manualUrl ?? null,
    uncensoredAmbiguous: result?.uncensoredAmbiguous === true,
  };
};

const liveLogToDto = (runId: string, log: ScrapeRunSnapshot["logs"][number], index: number): LogEntryDto => {
  const createdAt = log.timestamp.toISOString();
  return {
    id: `${runId}:live-log:${index}`,
    taskId: runId,
    type: "live-log",
    message: log.message,
    createdAt,
    source: "runtime",
    level: log.level === "error" ? "ERR" : log.level === "warn" ? "WARN" : "INFO",
  };
};

const liveAmbiguousUncensoredItems = (snapshot: ScrapeRunSnapshot): AmbiguousUncensoredItemDto[] =>
  snapshot.items
    .filter((item) => item.status === "success" && item.result?.uncensoredAmbiguous === true)
    .map((item) => ({
      id: item.result?.resultId ?? item.id,
      ref: { rootId: item.rootId, relativePath: item.relativePath },
      fileId: item.id,
      fileName: path.posix.basename(item.relativePath),
      number:
        item.result?.crawlerData?.number ??
        path.posix.basename(item.relativePath, path.posix.extname(item.relativePath)),
      title: item.result?.crawlerData?.title_zh ?? item.result?.crawlerData?.title ?? null,
      nfoRelativePath: item.result?.nfo?.relativePath ?? null,
    }));

export const scrapeResultPath = (result: Pick<ScrapeResult, "output" | "relativePath">): string =>
  result.output?.relativePath ?? result.relativePath;

export const scrapeResultNumber = (result: Pick<ScrapeResult, "crawlerData" | "fileName">): string =>
  result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, "");

export const toScrapeRunSnapshotDto = (input: {
  manifest: ScrapeSnapshotManifest;
  snapshot: ScrapeRunSnapshot;
  startedAt: Date | null;
  rootDisplayName: string;
}): ScrapeRunSnapshotDto => {
  const terminal = isTerminalStatus(input.snapshot.status);
  const now = new Date().toISOString();
  const taskStatus =
    input.snapshot.status === "stopped"
      ? "failed"
      : input.snapshot.status === "completed"
        ? "completed"
        : input.snapshot.status;
  return {
    task: {
      id: input.snapshot.runId,
      kind: "scrape",
      rootId: input.manifest.rootId,
      rootDisplayName: input.rootDisplayName,
      status: taskStatus,
      createdAt: input.manifest.createdAt.toISOString(),
      updatedAt: now,
      startedAt: input.startedAt?.toISOString() ?? null,
      completedAt: terminal ? now : null,
      videoCount: input.snapshot.items.filter((item) => item.status === "success").length,
      directoryCount: 0,
      error: input.snapshot.error,
      videos: input.manifest.items.map((item) => item.relativePath),
      continuity: terminal ? "final" : "live",
    },
    progress: { ...input.snapshot.progress },
    items: input.snapshot.items.map((item) => liveItemToDto(input.manifest, item)),
    latestStage: input.snapshot.latestStage
      ? {
          stage: input.snapshot.latestStage.stage,
          message: input.snapshot.latestStage.message,
          relativePath: input.snapshot.latestStage.relativePath,
        }
      : null,
    logs: input.snapshot.logs.map((log, index) => liveLogToDto(input.snapshot.runId, log, index)),
    ambiguousUncensoredItems: liveAmbiguousUncensoredItems(input.snapshot),
  };
};
