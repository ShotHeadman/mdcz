import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { readlink } from "node:fs/promises";
import path from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { PublicationConflictError } from "./conflicts";
import { outputFileSystem } from "./outputFileSystem";
import type { PublicationFileSystem } from "./types";
import { type WriteArtifact, WriteOutput } from "./WriteOutput";

export type MediaFileFacts = { dev: number; ino: number; size: number; mtimeMs: number };
export interface SourceMove extends MediaFileFacts {
  source: RootFileRef;
  target: RootFileRef;
  sourcePath: string;
  targetPath: string;
  rewrittenContent?: Buffer | string;
}

export const sameMediaFile = (left: MediaFileFacts, right: MediaFileFacts): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;

export const assertMoveTargetAbsent = async (targetPath: string, fs = outputFileSystem): Promise<void> => {
  try {
    await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new PublicationConflictError(targetPath, targetPath, "目标已存在，禁止替换媒体文件");
};

// Uncommitted media is put back where it came from so a retry sees the original source
// paths; each step is one atomic rename or one removal of a copy whose source is intact.
type Relocation = { from: string; to: string; kind: "renamed" | "copied" };

export class MoveOutput {
  constructor(
    private readonly fileSystem: PublicationFileSystem = outputFileSystem,
    private readonly logger: Pick<RuntimeLogger, "warn"> = runtimeLoggerService.getLogger("MoveOutput"),
  ) {}

  async install<TResult>(input: {
    moves: readonly SourceMove[];
    artifacts: readonly WriteArtifact[];
    validate?(): Promise<void> | void;
    commit(): TResult | Promise<TResult>;
    protectedMediaFiles?: readonly string[];
    reorganize?: boolean;
  }): Promise<TResult> {
    const fs = this.fileSystem;
    const temporaryPaths = new Set<string>();
    const retainedSources = new Map<string, MediaFileFacts>();
    const relocations: Relocation[] = [];
    const targets = new Set(input.moves.map((move) => filesystemPathKey(move.targetPath)));
    if (targets.size !== input.moves.length) throw new Error("Duplicate media move target");
    const targetEntries = new Map<string, Set<string>>();
    let committed = false;
    const assertSource = async (move: SourceMove, sourcePath: string, observed?: Stats) => {
      const current = observed ?? (await fs.stat(sourcePath));
      if (!current.isFile() || !sameMediaFile(current, move))
        throw new Error(`Publication source changed before mutation: ${sourcePath}`);
    };
    const assertTarget = async (move: SourceMove, sourcePath: string) => {
      if (isPrimaryVideoFileName(move.targetPath)) {
        const directory = path.dirname(move.targetPath);
        const directoryKey = filesystemPathKey(directory);
        let entries = targetEntries.get(directoryKey);
        if (!entries) {
          entries = new Set(
            (await fs.readdir(directory, { withFileTypes: true }))
              .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && isPrimaryVideoFileName(entry.name))
              .map((entry) => filesystemPathKey(path.join(directory, entry.name))),
          );
          targetEntries.set(directoryKey, entries);
        }
        const base = filesystemPathKey(path.join(directory, path.parse(move.targetPath).name));
        for (const candidate of entries) {
          if (candidate === filesystemPathKey(sourcePath)) continue;
          if (filesystemPathKey(path.join(directory, path.parse(candidate).name)) === base)
            throw new PublicationConflictError(move.sourcePath, candidate, "目标目录已存在同名影片");
        }
      }
      await assertMoveTargetAbsent(move.targetPath, fs);
    };
    try {
      return await new WriteOutput(fs, this.logger).install(input.artifacts, {
        validate: input.validate,
        protectedMediaFiles: [
          ...(input.protectedMediaFiles ?? []),
          ...input.moves.flatMap((move) => [move.sourcePath, move.targetPath]),
        ],
        beforeCommit: async () => {
          const parkedSources = new Map<string, string>();
          if (input.reorganize) {
            for (const move of input.moves) {
              if (!targets.has(filesystemPathKey(move.sourcePath))) continue;
              await assertSource(move, move.sourcePath);
              const parked = path.join(
                path.dirname(move.sourcePath),
                `.mdcz-relocation-${randomUUID()}-${path.basename(move.sourcePath)}`,
              );
              await assertMoveTargetAbsent(parked, fs);
              await fs.rename(move.sourcePath, parked);
              relocations.push({ from: move.sourcePath, to: parked, kind: "renamed" });
              parkedSources.set(move.sourcePath, parked);
            }
          }
          for (const move of input.moves) {
            const sourcePath = parkedSources.get(move.sourcePath) ?? move.sourcePath;
            await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
            const link = await fs.lstat(sourcePath);
            if (
              link.isSymbolicLink() &&
              !path.isAbsolute(await readlink(sourcePath)) &&
              path.dirname(sourcePath) !== path.dirname(move.targetPath)
            )
              throw new Error(`Cannot move a relative file symlink to another directory: ${sourcePath}`);
            await assertSource(move, sourcePath, link.isSymbolicLink() ? undefined : link);
            await assertTarget(move, sourcePath);
            let copied = move.rewrittenContent !== undefined;
            if (!copied) {
              try {
                await fs.rename(sourcePath, move.targetPath);
                relocations.push({ from: sourcePath, to: move.targetPath, kind: "renamed" });
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
                if (link.isSymbolicLink())
                  throw new Error(`Cannot copy a file symlink as source media: ${sourcePath}`, { cause: error });
                copied = true;
              }
            }
            if (copied) {
              const staging = `${move.targetPath}.mdcz-staging-${randomUUID()}.part`;
              temporaryPaths.add(staging);
              if (move.rewrittenContent !== undefined)
                await fs.writeFile(staging, move.rewrittenContent, { flush: true });
              else await fs.copyFile(sourcePath, staging);
              if (move.rewrittenContent === undefined) await fs.flush?.(staging);
              const expectedSize =
                move.rewrittenContent === undefined ? move.size : Buffer.byteLength(move.rewrittenContent);
              if ((await fs.stat(staging)).size !== expectedSize)
                throw new Error(`Staged transfer size mismatch: ${move.targetPath}`);
              await assertSource(move, sourcePath);
              await assertTarget(move, sourcePath);
              await fs.rename(staging, move.targetPath);
              temporaryPaths.delete(staging);
              relocations.push({ from: sourcePath, to: move.targetPath, kind: "copied" });
              retainedSources.set(sourcePath, move);
            } else {
              targetEntries.get(filesystemPathKey(path.dirname(sourcePath)))?.delete(filesystemPathKey(sourcePath));
            }
            if (isPrimaryVideoFileName(move.targetPath))
              targetEntries
                .get(filesystemPathKey(path.dirname(move.targetPath)))
                ?.add(filesystemPathKey(move.targetPath));
          }
        },
        commit: async () => {
          const value = await input.commit();
          committed = true;
          for (const [sourcePath, facts] of retainedSources) {
            try {
              if (!sameMediaFile(await fs.stat(sourcePath), facts))
                throw new Error("Source changed after transfer; leaving it intact");
              await fs.rm(sourcePath, { force: true });
            } catch (error) {
              this.logger.warn(`Published media but left source ${sourcePath}: ${toErrorMessage(error)}`);
            }
          }
          return value;
        },
      });
    } catch (error) {
      if (!committed) await this.restore(relocations);
      throw error;
    } finally {
      for (const staging of temporaryPaths) {
        try {
          await fs.rm(staging, { force: true });
        } catch (error) {
          this.logger.warn(`Failed to remove publication staging ${staging}: ${toErrorMessage(error)}`);
        }
      }
    }
  }

  private async restore(relocations: readonly Relocation[]): Promise<void> {
    for (const relocation of relocations.toReversed()) {
      try {
        if (relocation.kind === "copied") await this.fileSystem.rm(relocation.to, { force: true });
        else await this.fileSystem.rename(relocation.to, relocation.from);
      } catch (error) {
        this.logger.warn(
          `Uncommitted media remains at ${relocation.to} (originally ${relocation.from}): ${toErrorMessage(error)}`,
        );
      }
    }
  }
}
