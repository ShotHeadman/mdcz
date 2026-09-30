import { randomUUID } from "node:crypto";
import path from "node:path";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { outputFileSystem } from "./outputFileSystem";
import type { PublicationFileSystem } from "./types";

export type WriteArtifact = { targetPath: string; removeSourcesAfterCommit?: readonly string[] } & (
  | { data: Buffer | string }
  | { sourcePath: string; size: number; consume?: boolean }
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
    },
  ): Promise<TResult> {
    const staged: Array<{ targetPath: string; temporaryPath: string; size: number }> = [];
    const temporaryPaths = new Set<string>();
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
    try {
      for (const artifact of artifacts) {
        await this.fileSystem.mkdir(path.dirname(artifact.targetPath), { recursive: true });
        const consuming = "sourcePath" in artifact && consumedSources.get(pathKey(artifact.sourcePath)) === artifact;
        const temporaryPath =
          "sourcePath" in artifact && consuming
            ? artifact.sourcePath
            : `${artifact.targetPath}.mdcz-staging-${stagingId}.part`;
        if (consuming && !(await this.fileSystem.lstat(temporaryPath)).isFile())
          throw new Error(`Consumed staging must be a regular file: ${temporaryPath}`);
        temporaryPaths.add(temporaryPath);
        const expectedSize =
          "data" in artifact
            ? typeof artifact.data === "string"
              ? Buffer.byteLength(artifact.data, "utf8")
              : artifact.data.length
            : artifact.size;
        staged.push({ targetPath: artifact.targetPath, temporaryPath, size: expectedSize });
        if ("data" in artifact) {
          await this.fileSystem.writeFile(temporaryPath, artifact.data, { flush: true });
        } else {
          const source = await this.fileSystem.stat(artifact.sourcePath);
          if (!source.isFile() || source.size !== artifact.size)
            throw new Error(`Artifact source changed: ${artifact.sourcePath}`);
          if (!consuming) await this.fileSystem.copyFile(artifact.sourcePath, temporaryPath);
        }
        if (!("data" in artifact)) await this.fileSystem.flush?.(temporaryPath);
        if ((await this.fileSystem.stat(temporaryPath)).size !== expectedSize)
          throw new Error(`Staged artifact size mismatch: ${artifact.targetPath}`);
      }
      await options.validate?.();
      await options.beforeCommit?.();
      for (const artifact of staged) {
        try {
          const existing = await this.fileSystem.lstat(artifact.targetPath);
          if (!existing.isFile() && !existing.isSymbolicLink())
            throw new Error(`Artifact target is not a file: ${artifact.targetPath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await this.fileSystem.rename(artifact.temporaryPath, artifact.targetPath);
          temporaryPaths.delete(artifact.temporaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
          const localStaging = `${artifact.targetPath}.mdcz-staging-${stagingId}.part`;
          temporaryPaths.add(localStaging);
          await this.fileSystem.copyFile(artifact.temporaryPath, localStaging);
          await this.fileSystem.flush?.(localStaging);
          if ((await this.fileSystem.stat(localStaging)).size !== artifact.size)
            throw new Error(`Staged artifact size mismatch: ${artifact.targetPath}`);
          await this.fileSystem.rename(localStaging, artifact.targetPath);
          temporaryPaths.delete(localStaging);
        }
      }
      const value = await options.commit();
      const installedTargets = new Set(staged.map((artifact) => pathKey(artifact.targetPath)));
      const obsoleteSources = new Set(
        artifacts
          .flatMap((artifact) => artifact.removeSourcesAfterCommit ?? [])
          .filter(
            (sourcePath) => !installedTargets.has(pathKey(sourcePath)) && !protectedMedia.has(pathKey(sourcePath)),
          ),
      );
      for (const sourcePath of obsoleteSources) {
        try {
          await this.fileSystem.rm(sourcePath, { force: true });
        } catch (error) {
          this.logger.warn(`Published artifacts but failed to remove source ${sourcePath}: ${toErrorMessage(error)}`);
        }
      }
      return value;
    } finally {
      for (const temporaryPath of temporaryPaths) {
        try {
          await this.fileSystem.rm(temporaryPath, { force: true });
        } catch (error) {
          this.logger.warn(`Failed to remove publication staging ${temporaryPath}: ${toErrorMessage(error)}`);
        }
      }
    }
  }
}
