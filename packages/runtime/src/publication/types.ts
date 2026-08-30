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
  replaceExistingTargetPaths?: string[];
}

export interface PublicationFileSystem {
  copyFile(source: string, target: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<Stats>;
  statfs(path: string): Promise<{ bavail: number; bsize: number }>;
  writeFile(path: string, data: Buffer | string, options?: { flush?: boolean }): Promise<void>;
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

export interface PublicationJournalManifestEntry {
  rootId: string;
  relativePath: string;
  temporaryPath: string;
  backupPath: string | null;
  targetExisted: boolean;
}

export type PublicationObsoleteObservation =
  | { exists: false }
  | { exists: true; size: number; mtimeMs: number; isFile: boolean };

export interface PublicationJournalManifestObsolete extends RootFileRef {
  observed: PublicationObsoleteObservation;
}

export interface PublicationJournalManifest {
  entries: PublicationJournalManifestEntry[];
  obsolete: PublicationJournalManifestObsolete[];
}

export type PublicationJournalState = "pending" | "committed";

export interface PublicationJournalRecord {
  operationId: string;
  operationType: string;
  state: PublicationJournalState;
  manifest: PublicationJournalManifest;
  createdAt: Date;
}

export interface PublicationJournalPort {
  begin(entry: {
    operationId: string;
    operationType: string;
    manifest: PublicationJournalManifest;
    createdAt: Date;
  }): void;
  commit<T>(operationId: string, write: () => T): T;
  finish(operationId: string): void;
  conflicts(refs: readonly RootFileRef[]): { operationId: string } | null;
  listUnfinished(): PublicationJournalRecord[];
}

export interface DurablePublicationContext {
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
}

export interface RegisteredPublicationContext extends DurablePublicationContext {
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
}

export interface PublishMediaOptions<TResult> extends DurablePublicationContext {
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  commit(): TResult;
  download?(url: string): Promise<Uint8Array>;
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
