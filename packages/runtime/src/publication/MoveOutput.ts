import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { readlink } from "node:fs/promises";
import path from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFile } from "../scrape/media/generatedSidecarVideos";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { PublicationConflictError } from "./conflicts";
import { CreatedDirectories, outputFileSystem, removeEmptyDirectory } from "./outputFileSystem";
import { publicationJournal, TemporaryPaths } from "./publicationJournal";
import type { PublicationFileSystem } from "./types";
import { type WriteArtifact, WriteOutput } from "./WriteOutput";

export const PARKED_SOURCE_PREFIX = ".mdcz-relocation-";

export type MediaFileFacts = { dev: number; ino: number; size: number; mtimeMs: number };
export interface SourceMove extends MediaFileFacts {
  /** `hardlink` and `copy` leave the source in place. */
  transfer: "move" | "hardlink" | "copy";
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
  throw new PublicationConflictError(
    targetPath,
    targetPath,
    "Target already exists; overwriting media files is prohibited",
  );
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
    const temporaryPaths = new TemporaryPaths();
    const parkedPaths: string[] = [];
    const retainedSources = new Map<string, MediaFileFacts>();
    const relocations: Relocation[] = [];
    let renamedFolder: Relocation | undefined;
    const warn = (message: string) => this.logger.warn(message);
    const directories = new CreatedDirectories(fs);
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
      if (isPrimaryVideoFile(move.targetPath)) {
        const directory = path.dirname(move.targetPath);
        const directoryKey = filesystemPathKey(directory);
        let entries = targetEntries.get(directoryKey);
        if (!entries) {
          entries = new Set(
            (await fs.readdir(directory, { withFileTypes: true }))
              .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && isPrimaryVideoFile(entry.name))
              .map((entry) => filesystemPathKey(path.join(directory, entry.name))),
          );
          targetEntries.set(directoryKey, entries);
        }
        const base = filesystemPathKey(path.join(directory, path.parse(move.targetPath).name));
        for (const candidate of entries) {
          if (candidate === filesystemPathKey(sourcePath)) continue;
          if (filesystemPathKey(path.join(directory, path.parse(candidate).name)) === base)
            throw new PublicationConflictError(
              move.sourcePath,
              candidate,
              "A movie with the same name already exists in target directory",
            );
        }
      }
      await assertMoveTargetAbsent(move.targetPath, fs);
    };
    try {
      let { moves, artifacts, validate } = input;
      let protectedMediaFiles = input.protectedMediaFiles ?? [];
      const [first] = moves;
      const from = first && path.dirname(first.sourcePath);
      const to = first && path.dirname(first.targetPath);
      const inside = (directory: string, candidate: string) => {
        const relative = path.relative(directory, candidate);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      };
      const sources = new Set(moves.map((move) => filesystemPathKey(move.sourcePath)));
      // A movie that owns its folder is renamed with it, so a new name leaves no emptied folder behind.
      if (
        input.reorganize &&
        first?.source.relativePath.includes("/") &&
        filesystemPathKey(from) !== filesystemPathKey(to) &&
        !inside(from, to) &&
        moves.every(
          (move) =>
            filesystemPathKey(path.dirname(move.sourcePath)) === filesystemPathKey(from) &&
            filesystemPathKey(path.dirname(move.targetPath)) === filesystemPathKey(to),
        ) &&
        (await fs.readdir(from, { withFileTypes: true })).every(
          (entry) => !isPrimaryVideoFile(entry.name) || sources.has(filesystemPathKey(path.join(from, entry.name))),
        ) &&
        !(await fs.lstat(to).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        ))
      ) {
        // The renamed folder is this publication's from here on, so the old paths are checked before they vanish.
        await validate?.();
        validate = undefined;
        await directories.make(path.dirname(to));
        await fs.rename(from, to);
        renamedFolder = { from, to, kind: "renamed" };
        const carried = (value: string) => (inside(from, value) ? path.join(to, path.relative(from, value)) : value);
        moves = moves.map((move) => ({ ...move, sourcePath: carried(move.sourcePath) }));
        artifacts = artifacts.map((artifact) => ({
          ...artifact,
          ...("sourcePath" in artifact ? { sourcePath: carried(artifact.sourcePath) } : {}),
          removeSourcesAfterCommit: artifact.removeSourcesAfterCommit?.map(carried),
        }));
        protectedMediaFiles = protectedMediaFiles.map(carried);
      }
      const value = await new WriteOutput(fs, this.logger).install(artifacts, {
        validate,
        directories,
        protectedMediaFiles: [...protectedMediaFiles, ...moves.flatMap((move) => [move.sourcePath, move.targetPath])],
        beforeCommit: async () => {
          const parkedSources = new Map<string, string>();
          if (input.reorganize) {
            for (const move of moves) {
              if (!targets.has(filesystemPathKey(move.sourcePath))) continue;
              await assertSource(move, move.sourcePath);
              const parked = path.join(
                path.dirname(move.sourcePath),
                `${PARKED_SOURCE_PREFIX}${randomUUID()}-${path.basename(move.sourcePath)}`,
              );
              await assertMoveTargetAbsent(parked, fs);
              publicationJournal.record(parked, move.sourcePath);
              parkedPaths.push(parked);
              await fs.rename(move.sourcePath, parked);
              relocations.push({ from: move.sourcePath, to: parked, kind: "renamed" });
              parkedSources.set(move.sourcePath, parked);
            }
          }
          for (const move of moves) {
            const sourcePath = parkedSources.get(move.sourcePath) ?? move.sourcePath;
            await directories.make(path.dirname(move.targetPath));
            const link = await fs.lstat(sourcePath);
            if (
              link.isSymbolicLink() &&
              !path.isAbsolute(await readlink(sourcePath)) &&
              path.dirname(sourcePath) !== path.dirname(move.targetPath)
            )
              throw new Error(`Cannot move a relative file symlink to another directory: ${sourcePath}`);
            await assertSource(move, sourcePath, link.isSymbolicLink() ? undefined : link);
            if (move.transfer === "hardlink" && move.rewrittenContent === undefined) {
              // Re-publishing a file that already is the library's hardlink only refreshes its metadata.
              const existing = await fs.stat(move.targetPath).catch((error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return undefined;
                throw error;
              });
              const current = await fs.stat(sourcePath);
              if (existing && existing.dev === current.dev && existing.ino === current.ino) continue;
              await assertTarget(move, sourcePath);
              try {
                await fs.link(sourcePath, move.targetPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EXDEV")
                  throw new Error(
                    `Hardlinks need the library output on the same volume as the source: ${sourcePath} -> ${move.targetPath}`,
                    { cause: error },
                  );
                throw error;
              }
              relocations.push({ from: sourcePath, to: move.targetPath, kind: "copied" });
              if (isPrimaryVideoFile(move.targetPath))
                targetEntries
                  .get(filesystemPathKey(path.dirname(move.targetPath)))
                  ?.add(filesystemPathKey(move.targetPath));
              continue;
            }
            await assertTarget(move, sourcePath);
            let copied = move.rewrittenContent !== undefined || move.transfer !== "move";
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
              temporaryPaths.settle(staging);
              relocations.push({ from: sourcePath, to: move.targetPath, kind: "copied" });
              if (move.transfer === "move") retainedSources.set(sourcePath, move);
            } else {
              targetEntries.get(filesystemPathKey(path.dirname(sourcePath)))?.delete(filesystemPathKey(sourcePath));
            }
            if (isPrimaryVideoFile(move.targetPath))
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
      // A moved file leaves no empty folders between its old place and its media root, which itself always stays.
      for (const move of input.moves) {
        if (move.transfer !== "move") continue;
        let directory = path.dirname(move.sourcePath);
        let depth = move.source.relativePath.split("/").length - 1;
        // The renamed folder left as a whole, so its old parent is the first folder it may have emptied.
        if (renamedFolder && filesystemPathKey(directory) === filesystemPathKey(renamedFolder.from)) {
          directory = path.dirname(directory);
          depth--;
        }
        for (; depth > 0; depth--) {
          if (!(await removeEmptyDirectory(fs, directory, warn))) break;
          directory = path.dirname(directory);
        }
      }
      return value;
    } catch (error) {
      if (!committed) {
        await this.restore(relocations);
        if (renamedFolder) {
          // Folders created inside the renamed folder go before it takes its old name back.
          await directories.removeEmpty(warn);
          await this.restore([renamedFolder]);
        }
      }
      throw error;
    } finally {
      await temporaryPaths.removeAll(fs, warn);
      // A parked source still on disk could not be relocated or put back, so its record stays for recovery.
      for (const parked of parkedPaths) {
        const remaining = await fs.lstat(parked).then(
          () => true,
          (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
        );
        if (!remaining) publicationJournal.forget(parked);
      }
      if (!committed) await directories.removeEmpty(warn);
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
