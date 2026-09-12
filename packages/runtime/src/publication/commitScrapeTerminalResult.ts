import { stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, ScrapeResult } from "@mdcz/shared/types";
import { parseFileInfo } from "../scrape/utils/number";
import {
  publicationPathKey,
  publicationRefKey,
  resolvePublicationPath,
  resolvePublicationReferenceKeys,
} from "./boundary";
import { PublicationConflictError } from "./conflicts";
import { libraryEntryFromPublicationPlan } from "./libraryEntry";
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
  publicationPeers?(attemptId: string): Array<{ source: RootFileRef; target: RootFileRef; size: number }>;
  commitOutcome(input: { outcome: "failed" | "skipped"; attemptId: string; error?: string | null }): { id: string };
  commitSuccessOutcome(input: {
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
    libraryEntry: ReturnType<typeof libraryEntryFromPublicationPlan> & {
      id?: string;
      fileId?: string;
      mediaIdentity: string;
      size: number;
      crawlerDataJson: string;
      modifiedAt: Date | null;
      createdAt: Date;
    };
  }): { outcomeId: string; entryId: string };
}

export interface ScrapeFileTransitions {
  failed(): Promise<void>;
  succeeded(): Promise<void>;
}

export const commitScrapeTerminalResult = async (input: {
  result: ScrapeResult;
  attemptId: string;
  itemPath: string;
  success?: ScrapeSuccessPublicationFacts;
  scrapeRuns: ScrapeTerminalCommitStore;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  acquireAll?(refs: readonly RootFileRef[]): () => void;
  outputs?: PublicationOutputPort;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
  download?(url: string): Promise<Uint8Array>;
  fileTransitions: ScrapeFileTransitions;
}): Promise<ScrapeResult> => {
  const { result, attemptId, scrapeRuns } = input;
  const commitFailure = async (error: string, causes: unknown[] = []): Promise<ScrapeResult> => {
    let terminalError = error;
    try {
      await input.fileTransitions.failed();
    } catch (transitionError) {
      causes.push(transitionError);
      terminalError = `${terminalError}；失败文件移动失败：${errorMessage(transitionError)}`;
    }

    try {
      const outcome = scrapeRuns.commitOutcome({ outcome: "failed", attemptId, error: terminalError });
      return { ...result, resultId: outcome.id, status: "failed", error: terminalError };
    } catch (outcomeError) {
      if (causes.length === 0) throw outcomeError;
      throw new AggregateError([...causes, outcomeError], terminalError);
    }
  };

  if (result.status === "failed") {
    return await commitFailure(result.error?.trim() || "刮削失败");
  }
  if (result.status === "skipped") {
    const error = result.error?.trim() || null;
    const outcome = scrapeRuns.commitOutcome({ outcome: "skipped", attemptId, error });
    return { ...result, resultId: outcome.id, status: "skipped", error: error ?? undefined };
  }
  if (result.status !== "success") {
    throw new Error(`Cannot commit non-terminal scrape result: ${result.status}`);
  }
  const video = input.success?.plan.media?.[0];
  const output = video?.target;
  if (!input.success || !video || !output) {
    throw new Error(`Successful scrape has no publication plan: ${input.itemPath}`);
  }
  const success = input.success;
  const source = video.source;
  const sourcePath = resolveRootRelativePath(await input.resolveRoot(source.rootId), source.relativePath);
  const sourceStats = await (input.fileSystem?.stat ?? stat)(sourcePath);
  const peers = scrapeRuns.publicationPeers?.(attemptId) ?? [];
  const peerPaths = await Promise.all(
    peers.map(async (peer) =>
      resolveRootRelativePath(await input.resolveRoot(peer.target.rootId), peer.target.relativePath),
    ),
  );
  const snapshot = input.outputs?.publicationSnapshot({ paths: [sourcePath, ...peerPaths], includeOwners: true });
  const sourceKey = publicationPathKey(await resolvePublicationPath(sourcePath));
  const sourceKeys = await resolvePublicationReferenceKeys(
    [...(snapshot?.files ?? []), source],
    [source],
    input.resolveRoot,
  );
  const sourceFiles = (snapshot?.files ?? []).filter((file) => sourceKeys.get(publicationRefKey(file)) === sourceKey);
  if (new Set(sourceFiles.map((file) => file.itemId)).size > 1)
    throw new PublicationConflictError(sourcePath, sourcePath, "同一实际媒体被多个条目引用");
  const sourceFile = sourceFiles[0];
  const sourceInfo = parseFileInfo(sourcePath);
  if (sourceInfo.part && snapshot) {
    const groupKey = publicationPathKey(
      path.join(
        path.dirname(sourcePath),
        sourceInfo.fileName.replace(sourceInfo.part.suffix, "") + sourceInfo.extension,
      ),
    );
    for (const peer of peers) {
      const peerSource = await resolvePublicationPath(
        resolveRootRelativePath(await input.resolveRoot(peer.source.rootId), peer.source.relativePath),
      );
      const peerInfo = parseFileInfo(peerSource);
      if (
        !peerInfo.part ||
        publicationPathKey(
          path.join(path.dirname(peerSource), peerInfo.fileName.replace(peerInfo.part.suffix, "") + peerInfo.extension),
        ) !== groupKey
      )
        continue;
      const owner = snapshot.files.find(
        (file) => file.rootId === peer.target.rootId && file.relativePath === peer.target.relativePath,
      )?.itemId;
      if (!owner) continue;
      success.plan.media?.push({
        source: peer.target,
        target: peer.target,
        size: peer.size,
        assets: snapshot.assets
          .filter((asset) => asset.itemId === owner && !asset.historical)
          .map((asset) => ({
            type: "local",
            kind: asset.kind,
            file: { rootId: asset.rootId, relativePath: asset.relativePath },
          })),
      });
    }
  }
  success.size = video.size;
  success.modifiedAt = sourceStats.mtime;
  const crawlerData = success.crawlerData;
  if (!crawlerData) {
    throw new Error(`Successful scrape has no crawler data: ${input.itemPath}`);
  }
  const completedAt = new Date();
  const crawlerDataJson = JSON.stringify(crawlerData);
  const identity = success.identity.trim() || crawlerData.number;
  const nfoRootId = success.nfo && success.nfo.rootId !== output.rootId ? success.nfo.rootId : null;
  let committed: { value: { outcomeId: string; entryId: string }; cleanupError?: PublicationError };
  try {
    committed = await commitPublishedMediaResult(success.plan, {
      resolveRoot: input.resolveRoot,
      acquireAll: input.acquireAll,
      journal: input.journal,
      outputs: input.outputs,
      repairIssues: input.repairIssues,
      fileSystem: input.fileSystem,
      download: input.download,
      logContext: {
        runId: success.plan.operationId.split(":")[0],
        itemId: result.fileId,
      },
      commit: () =>
        scrapeRuns.commitSuccessOutcome({
          outcome: "success",
          error: result.error ?? null,
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
            id: sourceFile?.itemId,
            fileId: sourceFile?.fileId,
            mediaIdentity: identity,
            size: success.size,
            modifiedAt: success.modifiedAt,
            crawlerDataJson,
            createdAt: completedAt,
          },
        }),
    });
  } catch (error) {
    if (
      error instanceof PublicationConflictError ||
      (error instanceof AggregateError && error.errors.some((cause) => cause instanceof PublicationConflictError))
    )
      throw error;
    const coordinatedError = formatCommitFailure(error);
    return await commitFailure(coordinatedError, [error]);
  }
  await input.fileTransitions.succeeded();
  return {
    ...result,
    resultId: committed.value.outcomeId,
    status: "success",
    output,
    nfo: success.nfo ?? undefined,
    assets: success.plan.assets,
    ...(committed.cleanupError ? { error: formatCommitFailure(committed.cleanupError) } : {}),
  };
};
