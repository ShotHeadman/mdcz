import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationConflictError } from "./conflicts";
import { outputFileSystem } from "./outputFileSystem";
import type {
  PublicationFileSystem,
  PublicationJournalManifest,
  PublicationJournalPort,
  PublicationResult,
} from "./types";
import { type WriteArtifact, WriteOutput } from "./WriteOutput";

export interface SourceMove {
  source: RootFileRef;
  target: RootFileRef;
  sourcePath: string;
  targetPath: string;
  size: number;
  mtimeMs: number;
  rewrittenContent?: Buffer | string;
}

export const assertMoveTargetAbsent = async (targetPath: string): Promise<void> => {
  try {
    await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new PublicationConflictError(targetPath, targetPath, "目标已存在，禁止替换媒体或附属资源");
};

export const returnMovedFile = async (fs: PublicationFileSystem, from: string, source: string): Promise<void> => {
  await assertMoveTargetAbsent(source);
  try {
    await fs.rename(from, source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    if ((await lstat(from)).isSymbolicLink()) throw new Error(`Cannot copy a file symlink: ${from}`, { cause: error });
    await fs.copyFile(from, source);
    await fs.flush?.(source);
    await fs.rm(from, { force: true });
  }
};

export class MoveOutput {
  constructor(private readonly fileSystem: PublicationFileSystem = outputFileSystem) {}

  async install<TResult>(input: {
    operationId: string;
    operationType: "scrape" | "maintenance";
    moves: readonly SourceMove[];
    artifacts: readonly WriteArtifact[];
    journal: PublicationJournalPort;
    validate?(): Promise<void> | void;
    commit(): TResult;
    protectedSourceRoots?: readonly string[];
  }): Promise<PublicationResult<TResult>> {
    const fs = this.fileSystem;
    const moves = input.moves.map((move) => {
      const temporaryName = `${move.target.relativePath}.${randomUUID()}.part`;
      return {
        ...move,
        temporaryName,
        temporaryPath: path.join(path.dirname(move.targetPath), path.basename(temporaryName)),
        rewrittenTemporaryPath: path.join(
          path.dirname(move.targetPath),
          `${path.basename(temporaryName)}.rewrite.part`,
        ),
        installed: false,
        staged: false,
        copied: false,
      };
    });
    for (const move of moves) await assertMoveTargetAbsent(move.targetPath);
    const manifest: PublicationJournalManifest = {
      entries: moves.map((move) => ({
        ...move.target,
        source: move.source,
        temporaryPath: move.temporaryName,
        ...(move.rewrittenContent !== undefined ? { rewritten: true } : {}),
      })),
    };
    input.journal.begin({
      operationId: input.operationId,
      operationType: input.operationType,
      manifest,
      createdAt: new Date(),
    });
    const installedArtifacts: string[] = [];
    const postCommitCleanupIssues: unknown[] = [];
    let committed = false;
    try {
      const result = await new WriteOutput(fs).install(input.artifacts, {
        validate: input.validate,
        beforeInstall: assertMoveTargetAbsent,
        installed: (target) => installedArtifacts.push(target),
        commit: async () => {
          for (const move of moves) {
            await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
            const source = await fs.stat(move.sourcePath);
            if (!source.isFile() || source.size !== move.size || source.mtimeMs !== move.mtimeMs)
              throw new Error(`Publication source changed before mutation: ${move.sourcePath}`);
            await assertMoveTargetAbsent(move.targetPath);
            if (move.rewrittenContent !== undefined) {
              await returnMovedFile(fs, move.sourcePath, move.temporaryPath);
              move.staged = true;
              await fs.writeFile(move.rewrittenTemporaryPath, move.rewrittenContent, { flush: true });
              await fs.flush?.(move.rewrittenTemporaryPath);
              await assertMoveTargetAbsent(move.targetPath);
              await fs.rename(move.rewrittenTemporaryPath, move.targetPath);
              move.installed = true;
              continue;
            }
            try {
              await fs.rename(move.sourcePath, move.targetPath);
              move.installed = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
              if ((await lstat(move.sourcePath)).isSymbolicLink())
                throw new Error(`Cannot copy a file symlink as source media: ${move.sourcePath}`, { cause: error });
              move.copied = true;
              await fs.copyFile(move.sourcePath, move.temporaryPath);
              move.staged = true;
              await fs.flush?.(move.temporaryPath);
              if ((await fs.stat(move.temporaryPath)).size !== move.size)
                throw new Error(`Staged transfer size mismatch: ${move.targetPath}`);
              const current = await fs.stat(move.sourcePath);
              if (current.size !== move.size || current.mtimeMs !== move.mtimeMs)
                throw new Error(`Publication source changed before mutation: ${move.sourcePath}`);
              await assertMoveTargetAbsent(move.targetPath);
              await fs.rename(move.temporaryPath, move.targetPath);
              move.staged = false;
              move.installed = true;
            }
          }
          const value = input.journal.commit(input.operationId, input.commit);
          committed = true;
          for (const move of moves) {
            if (!move.copied) continue;
            try {
              await fs.rm(move.sourcePath, { force: true });
            } catch (error) {
              postCommitCleanupIssues.push(error);
            }
          }
          return value;
        },
        protectedSourceRoots: input.protectedSourceRoots,
      });
      result.cleanupIssues.push(...postCommitCleanupIssues);
      try {
        for (const move of moves) {
          await fs.rm(move.temporaryPath, { force: true });
          await fs.rm(move.rewrittenTemporaryPath, { force: true });
        }
        input.journal.finish(input.operationId);
      } catch (error) {
        result.cleanupIssues.push(error);
      }
      return result;
    } catch (error) {
      if (committed) throw error;
      const failures: unknown[] = [];
      for (const move of [...moves].reverse()) {
        try {
          if (move.staged && move.rewrittenContent !== undefined) {
            await returnMovedFile(fs, move.temporaryPath, move.sourcePath);
            if (move.installed) await fs.rm(move.targetPath, { force: true });
          } else if (move.installed) {
            if (move.copied) await fs.rm(move.targetPath, { force: true });
            else await returnMovedFile(fs, move.targetPath, move.sourcePath);
          }
          await fs.rm(move.temporaryPath, { force: true });
          await fs.rm(move.rewrittenTemporaryPath, { force: true });
        } catch (failure) {
          failures.push(failure);
        }
      }
      for (const target of installedArtifacts) {
        try {
          await fs.rm(target, { force: true });
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (!failures.length) {
        try {
          input.journal.finish(input.operationId);
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length) throw new AggregateError([error, ...failures], "Move output rollback failed");
      throw error;
    }
  }
}
