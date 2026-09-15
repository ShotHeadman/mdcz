import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeResult } from "@mdcz/shared/types";
import { parseFileInfo } from "../scrape/utils/number";
import { publicationRefKey, resolvePublicationReferenceKeys } from "./boundary";
import { PublicationConflictError } from "./conflicts";
import { libraryAssetsFromPublicationPlan } from "./libraryEntry";
import { commitPublishedMedia } from "./publishMedia";
import {
  PublicationError,
  type PublicationFileSystem,
  type PublicationJournalPort,
  type PublicationOutputPort,
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
  error instanceof PublicationError && error.committed
    ? `媒体库已提交，但清理失败：${errorMessage(error)}。请重新扫描`
    : `文件操作已回滚，媒体库提交失败：${errorMessage(error)}。请重新扫描`;

const commitPublishedMediaResult = async <TResult>(
  plan: PublicationPlan,
  options: PublishMediaOptions<TResult>,
): Promise<{ value: TResult; cleanupError?: PublicationError }> => {
  let committed: { value: TResult } | undefined;
  try {
    const value = await commitPublishedMedia(plan, {
      ...options,
      commit: () => {
        const value = options.commit();
        committed = { value };
        return value;
      },
    });
    return { value };
  } catch (error) {
    if (error instanceof PublicationError && error.committed && committed) {
      return { value: committed.value, cleanupError: error };
    }
    throw error;
  }
};

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
    },
  ): Array<{
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
    assets: ReturnType<typeof libraryAssetsFromPublicationPlan>;
    fileId?: string;
    partNumber?: number | null;
    partSuffix?: string | null;
    resolution?: string | null;
    size: number;
    modifiedAt: Date | null;
  };
}

export interface ScrapeTerminalGroupItem {
  result: ScrapeResult & {
    publicationPlan?: PublicationPlan;
  };
  attemptId: string;
  itemPath: string;
}

const normalizedMediaIdentity = (value: string | null | undefined): string => value?.trim().toUpperCase() ?? "";

const resolveRegisteredPublicationOwner = async (input: {
  plan: PublicationPlan;
  sources: readonly RootFileRef[];
  identity: string;
  outputs?: PublicationOutputPort;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<{
  sourceFiles: Array<ReturnType<PublicationOutputPort["publicationSnapshot"]>["files"][number] | undefined>;
  ownerId?: string;
}> => {
  if (!input.outputs) return { sourceFiles: input.sources.map(() => undefined) };
  const localAssets = input.plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : []));
  const requested = [
    ...input.sources,
    ...localAssets,
    ...(input.plan.media ?? []).flatMap((media) => [media.source, media.target]),
  ];
  const paths = await Promise.all(
    requested.map(async (ref) => resolveRootRelativePath(await input.resolveRoot(ref.rootId), ref.relativePath)),
  );
  const snapshot = input.outputs.publicationSnapshot({ paths, includeOwners: true });
  const keys = await resolvePublicationReferenceKeys(
    [...snapshot.files, ...snapshot.assets, ...requested],
    requested,
    input.resolveRoot,
  );
  const key = (ref: RootFileRef): string => {
    const value = keys.get(publicationRefKey(ref));
    if (!value) throw new Error(`Publication path was not resolved: ${publicationRefKey(ref)}`);
    return value;
  };
  const sourceFiles = input.sources.map((source) => {
    const matches = snapshot.files.filter((file) => key(file) === key(source));
    if (new Set(matches.map((file) => file.itemId)).size > 1) {
      throw new PublicationConflictError(source.relativePath, source.relativePath, "同一实际媒体被多个条目引用");
    }
    return matches[0];
  });
  const localAssetKeys = new Set(localAssets.map(key));
  const identity = normalizedMediaIdentity(input.identity);
  const matchingAssetOwners = snapshot.assets
    .filter((asset) => asset.published && !asset.historical && localAssetKeys.has(key(asset)))
    .map((asset) => asset.itemId)
    .filter((itemId) =>
      snapshot.files.some((file) => file.itemId === itemId && normalizedMediaIdentity(file.mediaIdentity) === identity),
    );
  const owners = new Set([...sourceFiles.flatMap((file) => (file ? [file.itemId] : [])), ...matchingAssetOwners]);
  if (owners.size > 1) {
    throw new PublicationConflictError(
      input.sources[0]?.relativePath ?? input.plan.operationId,
      localAssets[0]?.relativePath ?? input.plan.operationId,
      "候选影片文件或共享输出已属于不同媒体库条目",
    );
  }
  const ownerId = [...owners][0];
  if (!ownerId) return { sourceFiles };

  return { sourceFiles, ownerId };
};

interface ScrapeTerminalCommitContext {
  scrapeRuns: ScrapeTerminalCommitStore;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  acquireAll?(keys: readonly string[]): () => void;
  outputs?: PublicationOutputPort;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
}

const commitFailure = async (
  context: ScrapeTerminalCommitContext,
  item: ScrapeTerminalGroupItem,
  error: string,
  causes: readonly unknown[] = [],
): Promise<ScrapeResult> => {
  try {
    const outcome = context.scrapeRuns.commitOutcome({
      outcome: "failed",
      attemptId: item.attemptId,
      error,
    });
    return { ...item.result, resultId: outcome.id, status: "failed", error };
  } catch (outcomeError) {
    if (causes.length === 0) throw outcomeError;
    throw new AggregateError([...causes, outcomeError], error);
  }
};

const commitSettled = async (
  operations: readonly Promise<{ attemptId: string; result: ScrapeResult }>[],
): Promise<Map<string, ScrapeResult>> => {
  const settled = await Promise.allSettled(operations);
  const results = new Map<string, ScrapeResult>();
  const errors: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.set(outcome.value.attemptId, outcome.value.result);
    else errors.push(outcome.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Multiple scrape terminal outcomes could not be committed");
  return results;
};

export const commitScrapeTerminalResults = async (
  input: ScrapeTerminalCommitContext & {
    items: readonly ScrapeTerminalGroupItem[];
  },
): Promise<ScrapeResult[]> => {
  if (input.items.length === 0) throw new Error("Scrape terminal group must not be empty");

  const committedByAttemptId = new Map<string, ScrapeResult>();
  for (const item of input.items) {
    if (item.result.status !== "failed" && item.result.status !== "skipped" && item.result.status !== "success") {
      throw new Error(`Cannot commit non-terminal scrape result: ${item.result.status}`);
    }
    if (item.result.status === "success" && !item.result.publicationPlan) {
      throw new Error(`Successful scrape has no publication plan: ${item.itemPath}`);
    }
  }
  const successful = input.items.filter((item) => item.result.status === "success");
  const first = successful[0];
  if (first) {
    const plan = first.result.publicationPlan;
    if (!plan || plan.operationType !== "scrape" || successful.some((item) => item.result.publicationPlan !== plan)) {
      throw new Error("Scrape group must have one publication plan");
    }
    const sources = await Promise.all(
      successful.map(async (item) => {
        const video = plan.media?.find(
          (media) =>
            media.target.rootId === item.result.output?.rootId &&
            media.target.relativePath === item.result.output.relativePath,
        );
        if (!video) throw new Error(`Successful scrape has no publication plan: ${item.itemPath}`);
        const sourcePath = resolveRootRelativePath(
          await input.resolveRoot(video.source.rootId),
          video.source.relativePath,
        );
        const sourceStats = await (input.fileSystem?.stat ?? stat)(sourcePath);
        return { item, video, sourcePath, sourceStats, sourceInfo: parseFileInfo(sourcePath) };
      }),
    );
    const identities = sources.map(({ item }) => {
      const crawlerData = item.result.crawlerData;
      if (!crawlerData) throw new Error(`Successful scrape has no crawler data: ${item.itemPath}`);
      return crawlerData.number.trim() || item.result.fileName;
    });
    if (new Set(identities.map(normalizedMediaIdentity)).size > 1) {
      throw new Error("Scrape publication group contains different media identities");
    }
    const ownership = await resolveRegisteredPublicationOwner({
      plan,
      sources: sources.map(({ video }) => video.source),
      identity: identities[0] as string,
      outputs: input.outputs,
      resolveRoot: input.resolveRoot,
    });
    const itemId = ownership.ownerId ?? randomUUID();
    const completedAt = new Date();
    const crawlerData = first.result.crawlerData;
    if (!crawlerData) throw new Error("Scrape movie has no crawler data");
    const identity = crawlerData.number.trim() || first.result.fileName;
    const crawlerDataJson = JSON.stringify(crawlerData);
    const movie = {
      id: itemId,
      mediaIdentity: identity,
      number: identity,
      title: crawlerData.title,
      actors: crawlerData.actors,
      crawlerDataJson,
      createdAt: completedAt,
    };
    const commits: ScrapeSuccessOutcomeCommitInput[] = sources.map(
      ({ item, video, sourceStats, sourceInfo }, index) => {
        const output = video.target;
        return {
          outcome: "success",
          error: item.result.error ?? null,
          attemptId: item.attemptId,
          crawlerDataJson,
          nfoRootId: item.result.nfo && item.result.nfo.rootId !== output.rootId ? item.result.nfo.rootId : null,
          nfoRelativePath: item.result.nfo?.relativePath ?? null,
          outputRootId: output.rootId,
          outputRelativePath: output.relativePath,
          uncensoredAmbiguous: item.result.uncensoredAmbiguous === true,
          size: video.size,
          modifiedAt: sourceStats.mtime,
          completedAt,
          libraryEntry: {
            rootId: output.rootId,
            rootRelativePath: output.relativePath,
            lastKnownPath: output.relativePath,
            assets: libraryAssetsFromPublicationPlan({ assets: video.assets ?? plan.assets }),
            fileId: ownership.sourceFiles[index]?.fileId ?? undefined,
            partNumber: sourceInfo.part?.number ?? null,
            partSuffix: sourceInfo.part?.suffix ?? null,
            resolution: sourceInfo.resolution ?? null,
            size: video.size,
            modifiedAt: sourceStats.mtime,
          },
        };
      },
    );
    let committed:
      | { value: Array<{ outcomeId: string; entryId: string }>; cleanupError?: PublicationError }
      | undefined;
    try {
      committed = await commitPublishedMediaResult(plan, {
        resolveRoot: input.resolveRoot,
        acquireAll: input.acquireAll,
        journal: input.journal,
        outputs: input.outputs,
        ownerId: ownership.ownerId,
        repairIssues: input.repairIssues,
        fileSystem: input.fileSystem,
        logContext:
          successful.length === 1
            ? {
                runId: plan.operationId.split(":")[0],
                itemId: successful[0]?.result.fileId,
              }
            : undefined,
        commit: () => input.scrapeRuns.commitSuccessOutcomes(commits, movie),
      });
    } catch (error) {
      if (
        error instanceof PublicationConflictError ||
        (error instanceof AggregateError && error.errors.some((cause) => cause instanceof PublicationConflictError))
      ) {
        throw error;
      }
      const message = formatCommitFailure(error);
      const failed = await commitSettled(
        successful.map(async (item) => ({
          attemptId: item.attemptId,
          result: await commitFailure(input, item, message, [error]),
        })),
      );
      for (const [attemptId, result] of failed) committedByAttemptId.set(attemptId, result);
      committed = undefined;
    }
    if (committed) {
      successful.forEach((item, index) => {
        const outcome = committed.value[index];
        if (!outcome) throw new Error(`Scrape success batch omitted outcome: ${item.attemptId}`);
        committedByAttemptId.set(item.attemptId, {
          ...item.result,
          resultId: outcome.outcomeId,
          status: "success",
          output: sources[index]?.video.target,
          assets: sources[index]?.video.assets ?? plan.assets,
          ...(committed.cleanupError ? { error: formatCommitFailure(committed.cleanupError) } : {}),
        });
      });
    }
  }

  const terminal = await commitSettled(
    input.items
      .filter((item) => item.result.status !== "success")
      .map(async (item) => {
        if (item.result.status === "failed") {
          return {
            attemptId: item.attemptId,
            result: await commitFailure(input, item, item.result.error?.trim() || "刮削失败"),
          };
        }
        const error = item.result.error?.trim() || null;
        const outcome = input.scrapeRuns.commitOutcome({
          outcome: "skipped",
          attemptId: item.attemptId,
          error,
        });
        return {
          attemptId: item.attemptId,
          result: { ...item.result, resultId: outcome.id, status: "skipped" as const, error: error ?? undefined },
        };
      }),
  );
  for (const [attemptId, result] of terminal) committedByAttemptId.set(attemptId, result);

  return input.items.map((item) => {
    const result = committedByAttemptId.get(item.attemptId);
    if (!result) throw new Error(`Scrape terminal group omitted item: ${item.itemPath}`);
    return result;
  });
};
