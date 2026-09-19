import { randomUUID } from "node:crypto";
import path from "node:path";
import { isPathInside } from "@mdcz/media-store";
import { outputFileSystem } from "./outputFileSystem";
import type { PublicationFileSystem } from "./types";

export type WriteArtifact = { targetPath: string } & (
  | { data: Buffer | string }
  | { sourcePath: string; size: number; consume?: boolean }
);

export class WriteOutput {
  constructor(private readonly fileSystem: PublicationFileSystem = outputFileSystem) {}

  async install<TResult>(
    artifacts: readonly WriteArtifact[],
    options: {
      validate?(): Promise<void> | void;
      beforeInstall?(targetPath: string): Promise<void>;
      installed?(targetPath: string): void;
      commit(): TResult | Promise<TResult>;
      protectedSourceRoots?: readonly string[];
      protectedMediaFiles?: readonly string[];
    },
  ): Promise<{ value: TResult; cleanupIssues: unknown[] }> {
    const staged: Array<{ targetPath: string; temporaryPath: string }> = [];
    const cleanupIssues: unknown[] = [];
    let result: { value: TResult; cleanupIssues: unknown[] } | undefined;
    let failure: unknown;
    try {
      const pathKey = (value: string) =>
        process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
      const protectedMedia = new Set((options.protectedMediaFiles ?? []).map(pathKey));

      for (const artifact of artifacts) {
        if (protectedMedia.has(pathKey(artifact.targetPath)))
          throw new Error(`Write output target cannot overwrite a source media file: ${artifact.targetPath}`);
        const protectedRoot = options.protectedSourceRoots?.find((root) => isPathInside(root, artifact.targetPath));
        if (protectedRoot)
          throw new Error(`Write output target is inside a protected source root: ${artifact.targetPath}`);
        await this.fileSystem.mkdir(path.dirname(artifact.targetPath), { recursive: true });
        const temporaryPath = `${artifact.targetPath}.${randomUUID()}.part`;
        staged.push({ targetPath: artifact.targetPath, temporaryPath });
        const expectedSize =
          "data" in artifact
            ? typeof artifact.data === "string"
              ? Buffer.byteLength(artifact.data, "utf8")
              : artifact.data.length
            : artifact.size;
        if ("data" in artifact) {
          await this.fileSystem.writeFile(temporaryPath, artifact.data, { flush: true });
        } else {
          const source = await this.fileSystem.stat(artifact.sourcePath);
          if (!source.isFile() || source.size !== artifact.size)
            throw new Error(`Artifact source changed: ${artifact.sourcePath}`);
          if (artifact.consume) {
            try {
              await this.fileSystem.rename(artifact.sourcePath, temporaryPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
              await this.fileSystem.copyFile(artifact.sourcePath, temporaryPath);
            }
          } else await this.fileSystem.copyFile(artifact.sourcePath, temporaryPath);
        }
        await this.fileSystem.flush?.(temporaryPath);
        if ((await this.fileSystem.stat(temporaryPath)).size !== expectedSize)
          throw new Error(`Staged artifact size mismatch: ${artifact.targetPath}`);
      }
      await options.validate?.();
      for (const artifact of staged) {
        await options.beforeInstall?.(artifact.targetPath);
        await this.fileSystem.rename(artifact.temporaryPath, artifact.targetPath);
        options.installed?.(artifact.targetPath);
      }
      result = { value: await options.commit(), cleanupIssues };
    } catch (error) {
      failure = error;
    } finally {
      for (const artifact of staged) {
        try {
          await this.fileSystem.rm(artifact.temporaryPath, { force: true });
        } catch (error) {
          cleanupIssues.push(error);
        }
      }
    }
    if (!result) {
      if (cleanupIssues.length)
        throw new AggregateError([failure, ...cleanupIssues], "Write output staging cleanup failed");
      throw failure;
    }
    return result;
  }
}
