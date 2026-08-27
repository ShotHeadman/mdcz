import type { Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";

export type PublicationContent =
  | { kind: "bytes"; data: Buffer }
  | { kind: "text"; data: string }
  | { kind: "download"; url: string };

export interface PublicationPlan {
  operationId: string;
  operationType: "scrape" | "maintenance";
  video?: { source: RootFileRef; target: RootFileRef; size: number };
  artifacts: Array<{ target: RootFileRef; content: PublicationContent }>;
  assets: AssetRef[];
  obsolete: RootFileRef[];
  replaceExistingTargets?: RootFileRef[];
}

export interface PreparedPublicationPlan {
  video?: { sourcePath: string; targetPath: string; size: number };
  artifacts: Array<{ targetPath: string; content: Exclude<PublicationContent, { kind: "download" }> }>;
  assets: Array<{ kind: string; targetPath?: string; url?: string }>;
  obsoletePaths: string[];
}

export interface PublicationFileSystem {
  copyFile(source: string, target: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<Stats>;
  statfs(path: string): Promise<{ bavail: number; bsize: number }>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
}

export interface PublicationRepairPort {
  record(input: {
    operationId: string;
    operationType: PublicationPlan["operationType"];
    rootId: string;
    relativePath: string;
    errorMessage: string;
  }): Promise<void> | void;
  resolve(operationId: string, rootId: string, relativePath: string): Promise<void> | void;
}

export interface PublishMediaOptions<TResult> {
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  commit(): Promise<TResult>;
  download?(url: string): Promise<Uint8Array>;
  repairIssues?: PublicationRepairPort;
  acquireAll?(refs: readonly RootFileRef[]): () => void;
  fileSystem?: PublicationFileSystem;
}

export class PublicationError extends Error {
  constructor(
    message: string,
    readonly operationId: string,
    readonly committed: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PublicationError";
  }
}
