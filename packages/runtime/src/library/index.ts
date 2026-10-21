export * from "./availability";
export * from "./desktopInputRoot";
export * from "./desktopOutputRoot";
export * from "./entryDto";
export * from "./libraryScope";
export * from "./mediaLibraryService";
export * from "./mediaPathOwnership";
export * from "./mediaRootService";
export * from "./pendingService";
export * from "./registeredMedia";
export * from "./relink";

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
}

export interface RuntimeLibraryEntrySummaryInput {
  id?: string;
  number: string | null;
  fileName: string;
  title: string | null;
  actors: string[];
  thumbnailPath?: string | null;
  lastKnownPath: string | null;
  createdAt: Date | number | string;
  hiddenFromRecentAt?: Date | number | string | null;
  size?: number;
  available?: boolean | null;
}

export const toRuntimeLibraryEntrySummaryInput = (
  entry: Omit<RuntimeLibraryEntrySummaryInput, "fileName" | "lastKnownPath"> & {
    displayFileId: string;
    files: readonly { id: string; fileName: string; lastKnownPath: string | null }[];
  },
): RuntimeLibraryEntrySummaryInput => {
  const file = entry.files.find((candidate) => candidate.id === entry.displayFileId);
  if (!file) throw new Error(`Library display file not found: ${entry.id}`);
  return { ...entry, fileName: file.fileName, lastKnownPath: file.lastKnownPath };
};

/** Matches the single row the overview grid shows at its widest breakpoint. */
export const RECENT_ACQUISITION_LIMIT = 6;

export const sortAndLimitRecentAcquisitions = <T extends RuntimeRecentAcquisition>(
  items: readonly T[],
  limit: number,
): T[] =>
  [...items]
    .sort((left, right) => {
      const completedAtDiff = right.completedAt - left.completedAt;
      return completedAtDiff !== 0 ? completedAtDiff : left.number.localeCompare(right.number);
    })
    .slice(0, Math.max(0, Math.trunc(limit)));

export const createEmptyOutputLibrarySummary = (scannedAt: number): RuntimeOutputLibrarySummary => ({
  fileCount: 0,
  totalBytes: 0,
  scannedAt,
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

export const createOutputLibrarySummaryFromEntries = (
  entries: readonly RuntimeLibraryEntrySummaryInput[],
  scannedAt: number,
): RuntimeOutputLibrarySummary => ({
  fileCount: entries.length,
  totalBytes: entries.reduce((sum, entry) => sum + Math.max(0, Math.trunc(entry.size ?? 0)), 0),
  scannedAt,
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
    completedAt: toTimestampMs(entry.createdAt),
    available: entry.available,
  };
};

export const isVisibleRecentLibraryEntry = (
  entry: Pick<RuntimeLibraryEntrySummaryInput, "hiddenFromRecentAt">,
): boolean =>
  entry.hiddenFromRecentAt === null || entry.hiddenFromRecentAt === undefined || entry.hiddenFromRecentAt === "";

export const createRecentAcquisitionsFromEntries = (
  entries: readonly RuntimeLibraryEntrySummaryInput[],
): RuntimeRecentAcquisition[] =>
  sortAndLimitRecentAcquisitions(
    entries
      .filter(isVisibleRecentLibraryEntry)
      .map((entry) => toRuntimeRecentAcquisition(entry))
      .filter((entry): entry is RuntimeRecentAcquisition => entry !== null),
    RECENT_ACQUISITION_LIMIT,
  );
