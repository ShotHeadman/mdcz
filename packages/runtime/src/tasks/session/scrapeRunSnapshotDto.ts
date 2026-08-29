import path from "node:path";
import type { AssetRef } from "@mdcz/shared/mediaRef";
import type {
  AmbiguousUncensoredItemDto,
  LogEntryDto,
  ScrapeLiveItemDto,
  ScrapeRunSnapshotDto,
} from "@mdcz/shared/serverDtos";
import type { CrawlerData, ScrapeResult } from "@mdcz/shared/types";
import type { ScrapeRunItemSnapshot, ScrapeRunLiveStatus, ScrapeRunSnapshot } from "./ScrapeRunSession";

export interface ScrapeSnapshotManifest {
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
  const taskStatus =
    input.snapshot.status === "interrupted"
      ? "failed"
      : input.snapshot.status === "stopped"
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
      updatedAt: updatedAt.toISOString(),
      startedAt: input.startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      videoCount: input.snapshot.items.filter((item) => item.status === "success").length,
      directoryCount: 0,
      error: input.snapshot.error,
      videos: input.manifest.items.map((item) => item.relativePath),
      continuity: input.snapshot.status === "interrupted" ? "interrupted" : terminal ? "final" : "live",
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

export interface FinalizedScrapeRun {
  id: string;
  disposition: Extract<ScrapeRunLiveStatus, "completed" | "failed" | "stopped" | "interrupted">;
  error: string | null;
  items: Array<{ id: string; rootId: string; relativePath: string }>;
  outcomes: Array<{
    id: string;
    itemId: string;
    outcome: "success" | "failed" | "skipped";
    error: string | null;
    crawlerDataJson: string | null;
    nfoRootId: string | null;
    nfoRelativePath: string | null;
    outputRootId: string | null;
    outputRelativePath: string | null;
    uncensoredAmbiguous: boolean;
    assets?: Array<{ kind: string; uri: string; rootId: string | null; relativePath: string | null }>;
  }>;
}

const latestOutcomeByItem = (
  outcomes: FinalizedScrapeRun["outcomes"],
): Map<string, FinalizedScrapeRun["outcomes"][number]> => {
  const latest = new Map<string, FinalizedScrapeRun["outcomes"][number]>();
  for (const outcome of outcomes) latest.set(outcome.itemId, outcome);
  return latest;
};

const finalizedItemSnapshot = (
  item: FinalizedScrapeRun["items"][number],
  outcome: FinalizedScrapeRun["outcomes"][number] | undefined,
): ScrapeRunItemSnapshot => {
  if (!outcome) {
    return {
      id: item.id,
      rootId: item.rootId,
      relativePath: item.relativePath,
      sourcePath: item.relativePath,
      status: "pending",
      error: null,
    };
  }
  const crawlerData = outcome.crawlerDataJson ? (JSON.parse(outcome.crawlerDataJson) as CrawlerData) : undefined;
  const assets: AssetRef[] = [];
  for (const asset of outcome.assets ?? []) {
    if (asset.rootId && asset.relativePath) {
      assets.push({
        type: "local",
        kind: asset.kind,
        file: { rootId: asset.rootId, relativePath: asset.relativePath },
      });
    } else if (asset.uri) {
      assets.push({ type: "remote", kind: asset.kind, url: asset.uri });
    }
  }
  const nfoRootId = outcome.nfoRootId ?? outcome.outputRootId ?? item.rootId;
  const result: ScrapeResult = {
    fileId: item.id,
    rootId: item.rootId,
    relativePath: item.relativePath,
    fileName: path.posix.basename(item.relativePath),
    status: outcome.outcome,
    resultId: outcome.id,
    assets,
    ...(crawlerData ? { crawlerData } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.uncensoredAmbiguous ? { uncensoredAmbiguous: true } : {}),
    ...(outcome.nfoRelativePath ? { nfo: { rootId: nfoRootId, relativePath: outcome.nfoRelativePath } } : {}),
    ...(outcome.outputRootId && outcome.outputRelativePath
      ? { output: { rootId: outcome.outputRootId, relativePath: outcome.outputRelativePath } }
      : {}),
  };
  return {
    id: item.id,
    rootId: item.rootId,
    relativePath: item.relativePath,
    sourcePath: item.relativePath,
    status: outcome.outcome,
    error: outcome.error,
    result,
  };
};

export const toFinalizedScrapeRunSnapshot = (run: FinalizedScrapeRun): ScrapeRunSnapshot => {
  const latest = latestOutcomeByItem(run.outcomes);
  const items = run.items.map((item) => finalizedItemSnapshot(item, latest.get(item.id)));
  const completedItems = items.filter(
    (item) => item.status === "success" || item.status === "failed" || item.status === "skipped",
  ).length;
  return {
    runId: run.id,
    generation: 0,
    status: run.disposition,
    progress: {
      completedItems,
      totalItems: items.length,
      percent: items.length === 0 ? 0 : Math.round((completedItems / items.length) * 100),
    },
    items,
    latestStage: null,
    logs: [],
    error: run.error,
  };
};
