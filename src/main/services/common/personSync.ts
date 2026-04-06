import { readFile } from "node:fs/promises";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { isRecord } from "@main/utils/common";
import { imageContentTypeFromPath, pathExists } from "@main/utils/file";
import type { PersonSyncResult } from "@shared/ipcTypes";

export type PersonSyncBatchOutcome = "processed" | "skipped";

type ProgressSignalService = Pick<SignalService, "resetProgress" | "setProgress">;

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
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

export const loadPrimaryImageFromSource = async (
  networkClient: NetworkClient,
  source: string | undefined,
): Promise<LoadedPrimaryImage | null> => {
  const normalizedSource = source?.trim();
  if (!normalizedSource) {
    return null;
  }

  const content = (await pathExists(normalizedSource))
    ? await readFile(normalizedSource)
    : await networkClient.getContent(normalizedSource, {
        headers: {
          accept: "image/*",
        },
      });

  return {
    content,
    contentType: imageContentTypeFromPath(normalizedSource),
  };
};
