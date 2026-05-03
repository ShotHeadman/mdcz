import { readFile } from "node:fs/promises";
import type { PersonSyncResult } from "@mdcz/shared/ipcTypes";
import type { RuntimeNetworkClient } from "../network";
import { pathExists } from "../scrape/utils/filesystem";

export type PersonSyncBatchOutcome = "processed" | "skipped";

type ProgressSignalService = {
  resetProgress(): void;
  setProgress(value: number, current?: number, total?: number): void;
};

export interface LoadedPrimaryImage {
  content: Uint8Array;
  contentType: string;
}

export const createEmptyPersonSyncResult = (): PersonSyncResult => ({
  processedCount: 0,
  failedCount: 0,
  skippedCount: 0,
});

export const formatPersonSyncError = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (typeof code === "string" && typeof message === "string") {
      return `${code}: ${message}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const imageContentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
};

export const loadPrimaryImageFromSource = async (
  networkClient: RuntimeNetworkClient,
  source: string | undefined,
): Promise<LoadedPrimaryImage | null> => {
  const normalizedSource = source?.trim();
  if (!normalizedSource) {
    return null;
  }

  const content = (await pathExists(normalizedSource))
    ? await readFile(normalizedSource)
    : await networkClient.getContent?.(normalizedSource, {
        headers: {
          accept: "image/*",
        },
      });

  if (!content) {
    return null;
  }

  return {
    content,
    contentType: imageContentTypeFromPath(normalizedSource),
  };
};

export const runPersonSyncBatch = async <TItem>(options: {
  items: ReadonlyArray<TItem>;
  signalService: ProgressSignalService;
  processItem: (item: TItem) => Promise<PersonSyncBatchOutcome>;
  onError: (item: TItem, error: unknown) => void;
}): Promise<PersonSyncResult> => {
  if (options.items.length === 0) {
    return createEmptyPersonSyncResult();
  }

  let processedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let completed = 0;
  const total = options.items.length;

  options.signalService.resetProgress();

  for (const item of options.items) {
    try {
      const outcome = await options.processItem(item);
      if (outcome === "processed") {
        processedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      options.onError(item, error);
    } finally {
      completed += 1;
      options.signalService.setProgress(Math.round((completed / total) * 100), completed, total);
    }
  }

  return {
    processedCount,
    failedCount,
    skippedCount,
  };
};
