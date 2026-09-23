import path from "node:path";
import { type DiscoveryProgress, directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import type {
  AmbiguousUncensoredItemDto,
  LogEntryDto,
  ScrapeLiveItemDto,
  ScrapeRunSnapshotDto,
} from "@mdcz/shared/serverDtos";
import type { ScrapeRunItemSnapshot, ScrapeRunSnapshot } from "./ScrapeRunSession";

export interface ScrapeSnapshotManifest {
  directoryScopeJson?: string | null;
  discoveryJson?: string | null;
  manifestFixedAt?: Date | null;
  id: string;
  rootId: string;
  createdAt: Date;
  items: Array<{ id: string; rootId: string; relativePath: string; manualUrl?: string | null }>;
}

const isTerminalStatus = (status: ScrapeRunSnapshot["status"]): boolean =>
  status === "completed" || status === "failed" || status === "stopped" || status === "interrupted";

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
  snapshot.items.flatMap((item) => {
    if (item.status !== "success" || !item.result?.uncensoredAmbiguous || !item.result.resultId || !item.result.output)
      return [];
    return [
      {
        id: item.result.resultId,
        ref: item.result.output,
        fileId: item.result.resultId,
        fileName: path.posix.basename(item.relativePath),
        number:
          item.result.crawlerData?.number ??
          path.posix.basename(item.relativePath, path.posix.extname(item.relativePath)),
        title: item.result.crawlerData?.title_zh ?? item.result.crawlerData?.title ?? null,
        nfoRelativePath: item.result.nfo?.relativePath ?? null,
      },
    ];
  });

export const toScrapeRunSnapshotDto = (input: {
  manifest: ScrapeSnapshotManifest;
  snapshot: ScrapeRunSnapshot;
  startedAt: Date | null;
  rootDisplayName: string;
  completedAt?: Date | null;
}): ScrapeRunSnapshotDto => {
  const terminal = isTerminalStatus(input.snapshot.status);
  const completedAt = terminal ? (input.completedAt ?? new Date()) : null;
  const updatedAt = completedAt ?? new Date();
  return {
    task: {
      id: input.snapshot.runId,
      kind: "scrape",
      rootId: input.manifest.rootId,
      rootDisplayName: input.rootDisplayName,
      revision: input.snapshot.revision,
      status: input.snapshot.status,
      createdAt: input.manifest.createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      startedAt: input.startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      totalItems:
        input.manifest.directoryScopeJson && !input.manifest.manifestFixedAt
          ? null
          : input.snapshot.progress.totalItems,
      successCount: input.snapshot.items.filter((item) => item.status === "success").length,
      failedCount: input.snapshot.items.filter((item) => item.status === "failed").length,
      skippedCount: input.snapshot.items.filter((item) => item.status === "skipped").length,
      error: input.snapshot.error,
      continuity: input.snapshot.status === "interrupted" ? "interrupted" : terminal ? "final" : "live",
    },
    directorySource: input.manifest.directoryScopeJson
      ? directoryTaskScopeSchema.parse(JSON.parse(input.manifest.directoryScopeJson))
      : null,
    discovery:
      input.snapshot.discovery ??
      (input.manifest.discoveryJson ? (JSON.parse(input.manifest.discoveryJson) as DiscoveryProgress) : null),
    progress:
      input.manifest.directoryScopeJson && !input.manifest.manifestFixedAt
        ? { ...input.snapshot.progress, percent: null, totalItems: null }
        : { ...input.snapshot.progress },
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
