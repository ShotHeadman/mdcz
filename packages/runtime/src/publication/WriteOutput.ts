import { randomUUID } from "node:crypto";
import path from "node:path";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { CreatedDirectories, copyFileBytes, outputFileSystem } from "./outputFileSystem";
import { publicationJournal, TemporaryPaths } from "./publicationJournal";
import type { PublicationFileSystem } from "./types";

export type WriteArtifact = { targetPath: string; removeSourcesAfterCommit?: readonly string[] } & (
  | { data: Buffer | string }
  | { sourcePath: string; size: number; consume?: boolean }
  | { symlinkTo: string }
);

export class WriteOutput {
  constructor(
    private readonly fileSystem: PublicationFileSystem = outputFileSystem,
    private readonly logger: Pick<RuntimeLogger, "warn"> = runtimeLoggerService.getLogger("WriteOutput"),
  ) {}

  async install<TResult>(
    artifacts: readonly WriteArtifact[],
    options: {
      validate?(): Promise<void> | void;
      beforeCommit?(): Promise<void> | void;
      commit(): TResult | Promise<TResult>;
      protectedMediaFiles?: readonly string[];
      /** The caller's, which then takes back the empty folders itself once it has restored what else it moved. */
      directories?: CreatedDirectories;
      /**
       * Writes each target under its final name instead of renaming a temporary file onto it, and copies sources
       * byte by byte instead of letting the kernel do it, for cloud mounts that refuse both on a freshly created
       * file. A target is then replaced without being atomic.
       */
      direct?: boolean;
    },
  ): Promise<TResult> {
    const directories = options.directories ?? new CreatedDirectories(this.fileSystem);
    const staged: Array<{ artifact: WriteArtifact; temporaryPath?: string; size?: number }> = [];
    const replacements: Array<{ targetPath: string; backupPath?: string; linkedBackup?: boolean; installed: boolean }> =
      [];
    const temporaryPaths = new TemporaryPaths();
    let committed = false;
    const stagingId = randomUUID();
    const pathKey = (value: string) =>
      process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    const protectedMedia = new Set((options.protectedMediaFiles ?? []).map(pathKey));
    const targets = new Set<string>();
    const consumedSources = new Map<string, WriteArtifact>();
    for (const artifact of artifacts) {
      const target = pathKey(artifact.targetPath);
      if (protectedMedia.has(target))
        throw new Error(`Write output target cannot overwrite a source media file: ${artifact.targetPath}`);
      if (targets.has(target)) throw new Error(`Duplicate artifact target: ${artifact.targetPath}`);
      targets.add(target);
    }
    for (const artifact of artifacts) {
      if (!("sourcePath" in artifact) || !artifact.consume) continue;
      const source = pathKey(artifact.sourcePath);
      if (protectedMedia.has(source) || targets.has(source))
        throw new Error(`Cannot consume a media file or final artifact: ${artifact.sourcePath}`);
      consumedSources.set(source, artifact);
    }
    const write = async (
      artifact: WriteArtifact,
      destination: string,
      size: number | undefined,
      plain = false,
    ): Promise<void> => {
      if ("symlinkTo" in artifact) return await this.fileSystem.symlink(artifact.symlinkTo, destination);
      if ("data" in artifact) {
        await this.fileSystem.writeFile(destination, artifact.data, { flush: true });
      } else {
        // The kernel's accelerated copy stamps times and modes on the file it creates, which a cloud mount refuses
        // for as long as the upload registers; a byte stream is the only write it always accepts.
        if (plain) await copyFileBytes(artifact.sourcePath, destination);
        else await this.fileSystem.copyFile(artifact.sourcePath, destination);
        await this.fileSystem.flush?.(destination);
      }
      if ((await this.fileSystem.stat(destination)).size !== size)
        throw new Error(`Staged artifact size mismatch: ${artifact.targetPath}`);
    };
    try {
      for (const artifact of artifacts) {
        // Already in place, e.g. carried along when its movie folder was renamed.
        if ("sourcePath" in artifact && pathKey(artifact.sourcePath) === pathKey(artifact.targetPath)) continue;
        await directories.make(path.dirname(artifact.targetPath));
        const consuming = "sourcePath" in artifact && consumedSources.get(pathKey(artifact.sourcePath)) === artifact;
        if ("sourcePath" in artifact) {
          if (consuming) {
            if (!(await this.fileSystem.lstat(artifact.sourcePath)).isFile())
              throw new Error(`Consumed staging must be a regular file: ${artifact.sourcePath}`);
            temporaryPaths.add(artifact.sourcePath);
          }
          const source = await this.fileSystem.stat(artifact.sourcePath);
          if (!source.isFile() || source.size !== artifact.size)
            throw new Error(`Artifact source changed: ${artifact.sourcePath}`);
        }
        const size =
          "symlinkTo" in artifact
            ? undefined
            : "data" in artifact
              ? typeof artifact.data === "string"
                ? Buffer.byteLength(artifact.data, "utf8")
                : artifact.data.length
              : artifact.size;
        if (options.direct) {
          staged.push({ artifact, size });
          continue;
        }
        if ("sourcePath" in artifact && consuming) {
          await this.fileSystem.flush?.(artifact.sourcePath);
          staged.push({ artifact, temporaryPath: artifact.sourcePath, size });
          continue;
        }
        const temporaryPath = `${artifact.targetPath}.mdcz-staging-${stagingId}.part`;
        temporaryPaths.add(temporaryPath);
        await write(artifact, temporaryPath, size);
        staged.push({ artifact, temporaryPath, size });
      }
      await options.validate?.();
      await options.beforeCommit?.();
      for (const { artifact, temporaryPath, size } of staged) {
        const { targetPath } = artifact;
        let existingTarget: Awaited<ReturnType<PublicationFileSystem["lstat"]>> | undefined;
        try {
          const existing = await this.fileSystem.lstat(targetPath);
          if (!existing.isFile() && !existing.isSymbolicLink())
            throw new Error(`Artifact target is not a file: ${targetPath}`);
          existingTarget = existing;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const replacement: (typeof replacements)[number] = { targetPath, installed: false };
        const direct = temporaryPath === undefined;
        if (existingTarget) {
          // A hard link keeps the target in place until the atomic replace, so a stop never leaves it missing.
          // Symlinks, which link(2) may follow to back up the wrong file, filesystems without links, and direct
          // writes, which would write through the link, move the original aside instead.
          const backupPath = `${targetPath}.mdcz-backup-${stagingId}`;
          replacement.linkedBackup =
            !direct &&
            existingTarget.isFile() &&
            (await this.fileSystem.link(targetPath, backupPath).then(
              () => true,
              () => false,
            ));
          if (!replacement.linkedBackup) {
            if (direct) publicationJournal.record(backupPath, targetPath);
            await this.fileSystem.rename(targetPath, backupPath);
          }
          replacement.backupPath = backupPath;
        }
        replacements.push(replacement);
        if (direct) {
          // Journaled while it is written, so a crash leaves no truncated file under a final name and the
          // original it replaces goes back.
          publicationJournal.record(targetPath);
          // Set first, so a failed write is taken back like a finished one.
          replacement.installed = true;
          await write(artifact, targetPath, size, true);
          publicationJournal.forget(targetPath);
          // The target is whole from here on, so a crash before the commit drops the original instead of restoring it.
          if (replacement.backupPath) publicationJournal.record(replacement.backupPath);
          continue;
        }
        try {
          await this.fileSystem.rename(temporaryPath, targetPath);
          temporaryPaths.settle(temporaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EXDEV" || size === undefined) throw error;
          const localStaging = `${targetPath}.mdcz-staging-${stagingId}.part`;
          temporaryPaths.add(localStaging);
          await this.fileSystem.copyFile(temporaryPath, localStaging);
          await this.fileSystem.flush?.(localStaging);
          if ((await this.fileSystem.stat(localStaging)).size !== size)
            throw new Error(`Staged artifact size mismatch: ${targetPath}`);
          await this.fileSystem.rename(localStaging, targetPath);
          temporaryPaths.settle(localStaging);
        }
        replacement.installed = true;
      }
      const value = await options.commit();
      committed = true;
      for (const replacement of replacements) {
        if (replacement.backupPath) temporaryPaths.add(replacement.backupPath);
      }
      const obsoleteSources = new Set(
        artifacts
          .flatMap((artifact) => artifact.removeSourcesAfterCommit ?? [])
          .filter((sourcePath) => !targets.has(pathKey(sourcePath)) && !protectedMedia.has(pathKey(sourcePath))),
      );
      for (const sourcePath of obsoleteSources) {
        try {
          await this.fileSystem.rm(sourcePath, { force: true });
        } catch (error) {
          this.logger.warn(`Published artifacts but failed to remove source ${sourcePath}: ${toErrorMessage(error)}`);
        }
      }
      return value;
    } catch (error) {
      if (!committed) {
        for (const replacement of replacements.toReversed()) {
          const { backupPath, targetPath } = replacement;
          try {
            if (backupPath && (replacement.installed || !replacement.linkedBackup))
              await this.fileSystem.rename(backupPath, targetPath);
            else if (backupPath) temporaryPaths.add(backupPath);
            else if (replacement.installed) await this.fileSystem.rm(targetPath, { force: true });
            // The records of a direct write that failed would otherwise undo this restore on the next start.
            if (options.direct) {
              publicationJournal.forget(targetPath);
              if (backupPath) publicationJournal.forget(backupPath);
            }
          } catch (restoreError) {
            this.logger.warn(
              `Failed to restore artifact ${targetPath}${backupPath ? ` from ${backupPath}` : ""}: ${toErrorMessage(restoreError)}`,
            );
          }
        }
      }
      throw error;
    } finally {
      await temporaryPaths.removeAll(this.fileSystem, (message) => this.logger.warn(message));
      if (!committed && !options.directories) await directories.removeEmpty((message) => this.logger.warn(message));
    }
  }
}
