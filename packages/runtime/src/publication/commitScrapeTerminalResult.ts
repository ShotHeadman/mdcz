import type { MediaRoot } from "@mdcz/media-store";
import { toErrorMessage } from "@mdcz/shared/error";
import type { ScrapeResult } from "@mdcz/shared/types";
import { PublicationConflictError } from "./conflicts";
import {
  libraryAssetsFromPublicationPlan,
  type PublicationLibraryAsset,
  publicationResultAssets,
} from "./libraryEntry";
import { commitPublishedMedia } from "./publishMedia";
import type {
  MoviePublicationPlan,
  PublicationFileSystem,
  PublicationJournalPort,
  PublicationOutputPort,
  PublicationRepairPort,
  PublicationResult,
} from "./types";

const formatCommitFailure = (error: unknown, committed = false): string =>
  committed
    ? `媒体库已提交，但清理失败：${toErrorMessage(error)}。请重新扫描`
    : `文件操作已回滚，媒体库提交失败：${toErrorMessage(error)}。请重新扫描`;

export interface ScrapeTerminalCommitStore {
  commitOutcome(input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }): { id: string };
  commitSuccessOutcomes(
    inputs: readonly ScrapeSuccessOutcomeCommitInput[],
    movie: {
      id: string;
      mediaIdentity: string;
      title: string;
      number: string;
      actors: string[];
      crawlerDataJson: string;
      createdAt: Date;
      assets: PublicationLibraryAsset[];
    },
  ): Array<{
    attemptId: string;
    fileId: string;
    outcomeId: string;
    entryId: string;
  }>;
}

export interface ScrapeSuccessOutcomeCommitInput {
  outcome: "success";
  error?: string | null;
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
  libraryEntry: {
    rootId: string;
    rootRelativePath: string;
    lastKnownPath: string;
    assets: PublicationLibraryAsset[];
    fileId: string;
    partNumber?: number | null;
    partSuffix?: string | null;
    resolution?: string | null;
    size: number;
    modifiedAt: Date | null;
  };
}

export interface ScrapeTerminalGroupItem {
  result: ScrapeResult;
  attemptId: string;
}

interface ScrapeTerminalCommitContext {
  scrapeRuns: ScrapeTerminalCommitStore;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  acquireAll?(keys: readonly string[]): () => void;
  outputs?: PublicationOutputPort;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
}

export const commitScrapeTerminalResults = async (
  input: ScrapeTerminalCommitContext & {
    publicationPlan?: MoviePublicationPlan;
    items: readonly ScrapeTerminalGroupItem[];
  },
): Promise<ScrapeResult[]> => {
  if (input.items.length === 0 && !input.publicationPlan) throw new Error("Scrape terminal group must not be empty");

  const results: ScrapeResult[] = [];
  const terminal: Array<ScrapeTerminalGroupItem & { cause?: unknown }> = [...input.items];
  for (const item of input.items) {
    if (item.result.status !== "failed" && item.result.status !== "skipped")
      throw new Error("Only failed/skipped outcomes may precede publication");
  }
  const plan = input.publicationPlan;
  if (plan) {
    const group = plan.scrape;
    if (!group || plan.operationType !== "scrape" || !plan.files.length)
      throw new Error("Scrape publication requires prepared movie facts and files");
    const { crawlerData, nfo } = group;
    const completedAt = new Date();
    const identity = crawlerData.number.trim() || plan.files[0].scrape?.identity.fileName;
    if (!identity) throw new Error("Scrape movie has no media identity");
    const crawlerDataJson = JSON.stringify(crawlerData);
    const movie = {
      id: plan.movieId,
      assets: libraryAssetsFromPublicationPlan(plan, plan.movieAssets),
      mediaIdentity: identity,
      number: identity,
      title: crawlerData.title,
      actors: crawlerData.actors,
      crawlerDataJson,
      createdAt: completedAt,
    };
    const commits = plan.files.map((video): ScrapeSuccessOutcomeCommitInput => {
      const facts = video.scrape;
      if (!facts) throw new Error("Scrape file has no prepared facts");
      return {
        outcome: "success",
        error: facts.error ?? null,
        attemptId: facts.attemptId,
        crawlerDataJson,
        nfoRootId: nfo && nfo.rootId !== video.target.rootId ? nfo.rootId : null,
        nfoRelativePath: nfo?.relativePath ?? null,
        outputRootId: video.target.rootId,
        outputRelativePath: video.target.relativePath,
        uncensoredAmbiguous: facts.uncensoredAmbiguous,
        size: video.size,
        modifiedAt: video.modifiedAt,
        completedAt,
        libraryEntry: {
          fileId: video.fileId,
          rootId: video.target.rootId,
          rootRelativePath: video.target.relativePath,
          size: video.size,
          assets: libraryAssetsFromPublicationPlan(plan, video.assets),
          lastKnownPath: video.target.relativePath,
          partNumber: facts.fileInfo.part?.number ?? null,
          partSuffix: facts.fileInfo.part?.suffix ?? null,
          resolution: facts.fileInfo.resolution ?? null,
          modifiedAt: video.modifiedAt,
        },
      };
    });
    let committed:
      | PublicationResult<Array<{ attemptId: string; fileId: string; outcomeId: string; entryId: string }>>
      | undefined;
    try {
      committed = await commitPublishedMedia(plan, {
        resolveRoot: input.resolveRoot,
        acquireAll: input.acquireAll,
        journal: input.journal,
        outputs: input.outputs,
        repairIssues: input.repairIssues,
        fileSystem: input.fileSystem,
        commit: () => {
          const outcomes = input.scrapeRuns.commitSuccessOutcomes(commits, movie);
          const byAttempt = new Map(outcomes.map((outcome) => [outcome.attemptId, outcome]));
          if (
            outcomes.length !== commits.length ||
            byAttempt.size !== commits.length ||
            commits.some((commit) => {
              const outcome = byAttempt.get(commit.attemptId);
              return !outcome || outcome.fileId !== commit.libraryEntry.fileId || outcome.entryId !== plan.movieId;
            })
          )
            throw new Error("Scrape success batch does not match declared attempts and files");
          return outcomes;
        },
      });
    } catch (error) {
      if (
        error instanceof PublicationConflictError ||
        (error instanceof AggregateError && error.errors.some((cause) => cause instanceof PublicationConflictError))
      ) {
        throw error;
      }
      const message = formatCommitFailure(error);
      for (const file of plan.files) {
        const facts = file.scrape;
        if (!facts) throw new Error("Scrape file has no prepared facts");
        terminal.push({
          attemptId: facts.attemptId,
          cause: error,
          result: { ...facts.identity, fileId: facts.itemId, assets: [], status: "failed", error: message },
        });
      }
      committed = undefined;
    }
    if (committed) {
      const outcomes = new Map(committed.value.map((outcome) => [outcome.attemptId, outcome]));
      const cleanupError = committed.cleanupIssues.length
        ? formatCommitFailure(
            new AggregateError(
              committed.cleanupIssues,
              committed.cleanupIssues.map((issue) => toErrorMessage(issue)).join("; "),
            ),
            true,
          )
        : undefined;
      for (const video of plan.files) {
        const facts = video.scrape;
        if (!facts) throw new Error("Scrape file has no prepared facts");
        const outcome = outcomes.get(facts.attemptId);
        if (!outcome) throw new Error(`Scrape success batch omitted declared file: ${facts.attemptId}`);
        results.push({
          ...facts.identity,
          fileId: facts.itemId,
          crawlerData,
          sources: group.sources,
          videoMeta: facts.videoMeta,
          nfo,
          error: facts.error,
          uncensoredAmbiguous: facts.uncensoredAmbiguous,
          resultId: outcome.outcomeId,
          status: "success",
          output: video.target,
          assets: publicationResultAssets(plan, video),
          ...(cleanupError ? { error: cleanupError } : {}),
        });
      }
    }
  }

  const settled = await Promise.allSettled(
    terminal.map(async (item): Promise<ScrapeResult> => {
      const status = item.result.status;
      if (status !== "failed" && status !== "skipped") throw new Error("Cannot persist a non-terminal scrape outcome");
      const error = item.result.error?.trim() || (status === "failed" ? "刮削失败" : null);
      try {
        const outcome = input.scrapeRuns.commitOutcome({ outcome: status, attemptId: item.attemptId, error });
        return { ...item.result, resultId: outcome.id, status, error: error ?? undefined };
      } catch (outcomeError) {
        if (item.cause) throw new AggregateError([item.cause, outcomeError], error ?? undefined);
        throw outcomeError;
      }
    }),
  );
  const errors: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else errors.push(outcome.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Multiple scrape terminal outcomes could not be committed");
  return results;
};
