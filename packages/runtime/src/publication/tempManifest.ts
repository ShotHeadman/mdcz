import { randomUUID } from "node:crypto";
import { join, parse } from "node:path";
import type { PublicationFileSystem } from "./types";

export const createTargetTemporaryPath = (targetPath: string): string => {
  const target = parse(targetPath);
  return join(target.dir, `${target.base}.${randomUUID()}.part`);
};

export class PublicationTempManifest {
  readonly temporaryPaths = new Set<string>();
  readonly publishedPaths = new Set<string>();

  constructor(private readonly fileSystem: PublicationFileSystem) {}

  trackTemporary(path: string): void {
    this.temporaryPaths.add(path);
  }

  published(temporaryPath: string, targetPath: string): void {
    this.temporaryPaths.delete(temporaryPath);
    this.publishedPaths.add(targetPath);
  }

  async cleanBeforeCommit(): Promise<void> {
    await Promise.all([
      ...[...this.temporaryPaths].map(async (path) => await this.fileSystem.rm(path, { force: true })),
      ...[...this.publishedPaths].map(async (path) => await this.fileSystem.rm(path, { force: true })),
    ]);
    this.temporaryPaths.clear();
    this.publishedPaths.clear();
  }
}
