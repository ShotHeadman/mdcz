import type { DownloadedAssets } from "@mdcz/shared/types";
import type { MediaRoot } from "@mdcz/storage";
import { toRootRelativePath } from "@mdcz/storage";

export * from "./desktopOutputRoot";

export interface RuntimeLibraryAsset {
  kind: string;
  uri: string;
  rootId?: string;
  relativePath?: string;
}

export interface RuntimeRecentAcquisition {
  id?: string;
  number: string;
  title: string | null;
  actors: string[];
  thumbnailPath?: string | null;
  lastKnownPath: string | null;
  completedAt: number;
  available?: boolean | null;
}

export interface RuntimeOutputLibrarySummary {
  fileCount: number;
  totalBytes: number;
  scannedAt: number;
  rootPath: string | null;
}

export interface RuntimeScrapeOutputSummaryInput {
  fileCount: number;
  totalBytes: number;
  completedAt: Date | number | string;
  outputDirectory: string | null;
}

export interface RuntimeLibraryEntrySummaryInput {
  id?: string;
  number: string | null;
  fileName: string;
  title: string | null;
  actors: string[];
  thumbnailPath?: string | null;
  lastKnownPath: string | null;
  indexedAt: Date | number | string;
  size?: number;
  available?: boolean | null;
}

export interface RuntimeLibraryOverview {
  output: RuntimeOutputLibrarySummary;
  recentAcquisitions: RuntimeRecentAcquisition[];
}

const isRemoteAssetUri = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

export const toLibraryAsset = (
  root: Pick<MediaRoot, "id" | "hostPath"> | null | undefined,
  kind: string,
  uri: string | undefined,
): RuntimeLibraryAsset | null => {
  const value = uri?.trim();
  if (!value) {
    return null;
  }

  if (!root || isRemoteAssetUri(value)) {
    return { kind, uri: value };
  }

  try {
    const relativePath = toRootRelativePath(root, value);
    return {
      kind,
      uri: relativePath,
      rootId: root.id,
      relativePath,
    };
  } catch {
    return { kind, uri: value };
  }
};

export const toLibraryAssets = (
  root: Pick<MediaRoot, "id" | "hostPath"> | null | undefined,
  assets: DownloadedAssets | undefined,
): RuntimeLibraryAsset[] => {
  if (!assets) {
    return [];
  }

  const mapped: RuntimeLibraryAsset[] = [];
  const add = (kind: string, uri: string | undefined) => {
    const asset = toLibraryAsset(root, kind, uri);
    if (asset) {
      mapped.push(asset);
    }
  };

  add("thumb", assets.thumb);
  add("poster", assets.poster);
  add("fanart", assets.fanart);
  add("trailer", assets.trailer);
  for (const sceneImage of assets.sceneImages) {
    add("scene", sceneImage);
  }

  return mapped;
};

export const sortAndLimitRecentAcquisitions = <T extends RuntimeRecentAcquisition>(
  items: readonly T[],
  limit = 50,
): T[] =>
  [...items]
    .sort((left, right) => {
      const completedAtDiff = right.completedAt - left.completedAt;
      return completedAtDiff !== 0 ? completedAtDiff : left.number.localeCompare(right.number);
    })
    .slice(0, Math.max(0, Math.trunc(limit)));

export const createEmptyOutputLibrarySummary = (
  scannedAt: number,
  rootPath: string | null = null,
): RuntimeOutputLibrarySummary => ({
  fileCount: 0,
  totalBytes: 0,
  scannedAt,
  rootPath,
});

export const toTimestampMs = (value: Date | number | string): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return Math.max(0, Math.trunc(value));
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const createOutputLibrarySummaryFromScrapeOutput = (
  output: RuntimeScrapeOutputSummaryInput | null | undefined,
  fallbackScannedAt: number,
): RuntimeOutputLibrarySummary =>
  output
    ? {
        fileCount: output.fileCount,
        totalBytes: output.totalBytes,
        scannedAt: toTimestampMs(output.completedAt),
        rootPath: output.outputDirectory,
      }
    : createEmptyOutputLibrarySummary(fallbackScannedAt);

export const createOutputLibrarySummaryFromEntries = (
  entries: readonly RuntimeLibraryEntrySummaryInput[],
  scannedAt: number,
  rootPath: string | null = null,
): RuntimeOutputLibrarySummary => ({
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + Math.max(0, Math.trunc(entry.size ?? 0)), 0),
  scannedAt,
  rootPath,
});

export const toRuntimeRecentAcquisition = (entry: RuntimeLibraryEntrySummaryInput): RuntimeRecentAcquisition | null => {
  const number = entry.number?.trim() || entry.fileName.trim();
  if (!number) {
    return null;
  }

  return {
    id: entry.id,
    number,
    title: entry.title,
    actors: entry.actors,
    thumbnailPath: entry.thumbnailPath ?? null,
    lastKnownPath: entry.lastKnownPath,
    completedAt: toTimestampMs(entry.indexedAt),
    available: entry.available,
  };
};

export const createRuntimeLibraryOverview = (input: {
  entries: readonly RuntimeLibraryEntrySummaryInput[];
  latestOutput?: RuntimeScrapeOutputSummaryInput | null;
  now?: number;
  recentLimit?: number;
  rootPath?: string | null;
}): RuntimeLibraryOverview => {
  const now = input.now ?? Date.now();
  const recentAcquisitions = sortAndLimitRecentAcquisitions(
    input.entries
      .map((entry) => toRuntimeRecentAcquisition(entry))
      .filter((entry): entry is RuntimeRecentAcquisition => entry !== null),
    input.recentLimit,
  );
  const output = input.latestOutput
    ? createOutputLibrarySummaryFromScrapeOutput(input.latestOutput, now)
    : createOutputLibrarySummaryFromEntries(input.entries, now, input.rootPath ?? null);

  return {
    output,
    recentAcquisitions,
  };
};
