import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, ScrapeResult } from "@mdcz/shared/types";
import { libraryEntryFromPublicationPlan } from "./libraryEntry";
import { commitPublishedMedia } from "./publishMedia";
import {
  PublicationError,
  type PublicationFileSystem,
  type PublicationJournalPort,
  type PublicationPlan,
  type PublicationRepairPort,
  type PublishMediaOptions,
} from "./types";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const formatCommitFailure = (error: unknown): string =>
  `文件操作已完成，但媒体库提交失败：${errorMessage(error)}。请重新扫描，以磁盘实际状态重新协调。`;

const commitPublishedMediaResult = async <TResult>(
  plan: PublicationPlan,
  options: PublishMediaOptions<TResult>,
): Promise<TResult> => {
  let committed: { value: TResult } | undefined;
  try {
    return await commitPublishedMedia(plan, {
      ...options,
      commit: () => {
        const value = options.commit();
        committed = { value };
        return value;
      },
    });
  } catch (error) {
    if (error instanceof PublicationError && error.committed && committed) return committed.value;
    throw error;
  }
};

export interface ScrapeSuccessPublicationFacts {
  plan: PublicationPlan;
  crawlerData?: CrawlerData;
  identity: string;
  nfo: RootFileRef | null;
  size: number;
  modifiedAt: Date | null;
  uncensoredAmbiguous: boolean;
}

export interface ScrapeTerminalCommitStore {
  commitOutcome(input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }): { id: string };
  commitSuccessOutcome(input: {
    outcome: "success";
    attemptId: string;
    crawlerDataJson: string;
    nfoRootId: string | null;
    nfoRelativePath: string | null;
    outputRootId: string;
    outputRelativePath: string;
    uncensoredAmbiguous: boolean;
    size: number;
    modifiedAt: Date | null;
    completedAt: Date;
    libraryEntry: ReturnType<typeof libraryEntryFromPublicationPlan> & {
      mediaIdentity: string;
      size: number;
      crawlerDataJson: string;
      modifiedAt: Date | null;
      createdAt: Date;
    };
  }): { outcomeId: string; entryId: string };
}

export const commitScrapeTerminalResult = async (input: {
  result: ScrapeResult;
  attemptId: string;
  itemPath: string;
  success?: ScrapeSuccessPublicationFacts;
  scrapeRuns: ScrapeTerminalCommitStore;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  acquireAll?(refs: readonly RootFileRef[]): () => void;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
  download?(url: string): Promise<Uint8Array>;
}): Promise<ScrapeResult> => {
  const { result, attemptId, scrapeRuns } = input;
  if (result.status === "failed" || result.status === "skipped") {
    const error = result.status === "failed" ? result.error?.trim() || "刮削失败" : result.error?.trim() || null;
    const outcome = scrapeRuns.commitOutcome({ outcome: result.status, attemptId, error });
    return { ...result, resultId: outcome.id, status: result.status, error: error ?? undefined };
  }
  if (result.status !== "success") {
    throw new Error(`Cannot commit non-terminal scrape result: ${result.status}`);
  }
  const output = input.success?.plan.video?.target;
  if (!input.success || !output) {
    throw new Error(`Successful scrape has no publication plan: ${input.itemPath}`);
  }
  const success = input.success;
  const crawlerData = success.crawlerData;
  if (!crawlerData) {
    throw new Error(`Successful scrape has no crawler data: ${input.itemPath}`);
  }
  const completedAt = new Date();
  const crawlerDataJson = JSON.stringify(crawlerData);
  const identity = success.identity.trim() || crawlerData.number;
  const nfoRootId = success.nfo && success.nfo.rootId !== output.rootId ? success.nfo.rootId : null;
  try {
    const committed = await commitPublishedMediaResult(success.plan, {
      resolveRoot: input.resolveRoot,
      acquireAll: input.acquireAll,
      journal: input.journal,
      repairIssues: input.repairIssues,
      fileSystem: input.fileSystem,
      download: input.download,
      commit: () =>
        scrapeRuns.commitSuccessOutcome({
          outcome: "success",
          attemptId,
          crawlerDataJson,
          nfoRootId,
          nfoRelativePath: success.nfo?.relativePath ?? null,
          outputRootId: output.rootId,
          outputRelativePath: output.relativePath,
          uncensoredAmbiguous: success.uncensoredAmbiguous,
          size: success.size,
          modifiedAt: success.modifiedAt,
          completedAt,
          libraryEntry: {
            ...libraryEntryFromPublicationPlan(
              success.plan,
              { title: crawlerData.title, number: identity, actors: crawlerData.actors },
              output,
            ),
            mediaIdentity: identity,
            size: success.size,
            modifiedAt: success.modifiedAt,
            crawlerDataJson,
            createdAt: completedAt,
          },
        }),
    });
    return { ...result, resultId: committed.outcomeId, status: "success" };
  } catch (error) {
    const coordinatedError = formatCommitFailure(error);
    try {
      const outcome = scrapeRuns.commitOutcome({ outcome: "failed", attemptId, error: coordinatedError });
      return { ...result, resultId: outcome.id, status: "failed", error: coordinatedError };
    } catch (failureError) {
      throw new AggregateError([error, failureError], coordinatedError);
    }
  }
};
