import type { Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";

export type PublicationContent =
  | { kind: "bytes"; data: Buffer }
  | { kind: "text"; data: string }
  | { kind: "file"; path: string; size: number }
  | { kind: "download"; url: string };

export interface PublicationMove {
  preserveSource?: boolean;
  shared?: boolean;
  source: RootFileRef;
  target: RootFileRef;
  size: number;
  /** Relative STRM targets must be re-anchored when the file changes directory. */
  content?: string;
}

export interface PublicationBoundary {
  writeRoots: Array<{ path: string; realPath: string }>;
  writablePaths: Array<{ path: string; realPath: string }>;
  readOnlyPaths: Array<{ path: string; realPath: string }>;
  readOnlyDirectories: Array<{ path: string; realPath: string }>;
}

export interface PublicationPlan {
  media?: Array<{ source: RootFileRef; target: RootFileRef; size: number; assets?: AssetRef[] }>;
  boundary?: PublicationBoundary;
  operationId: string;
  operationType: "scrape" | "maintenance";
  videos?: PublicationMove[];
  sidecars?: PublicationMove[];
  artifacts: Array<{ target: RootFileRef; content: PublicationContent }>;
  assets: AssetRef[];
  obsolete: RootFileRef[];
  editFiles?: RootFileRef[];
  replaceExistingTargets?: RootFileRef[];
}

export interface PreparedPublicationMove {
  preserveSource?: boolean;
  shared?: boolean;
  sourcePath: string;
  targetPath: string;
  size: number;
  content?: string;
}

export interface PreparedPublicationPlan {
  media?: Array<{ sourcePath: string; targetPath: string; size: number; assets?: PreparedPublicationPlan["assets"] }>;
  boundary?: PublicationBoundary;
  videos?: PreparedPublicationMove[];
  sidecars?: PreparedPublicationMove[];
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
  flush?(path: string): Promise<void>;
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

export interface PublicationFileIdentity {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

export interface PublicationJournalManifestEntry {
  staged?: PublicationFileIdentity;
  rootId: string;
  relativePath: string;
  temporaryPath: string;
  backupPath: string | null;
  targetExisted: boolean;
  /** Where a moved file came from; recovery must return the bytes there, never delete them. */
  source?: RootFileRef;
}

export type PublicationObsoleteObservation =
  | { exists: false }
  | { exists: true; size: number; mtimeMs: number; isFile: boolean };

export interface PublicationJournalManifestObsolete extends RootFileRef {
  observed: PublicationObsoleteObservation;
}

export interface PublicationJournalManifest {
  boundary?: PublicationBoundary;
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
  stage(operationId: string, manifest: PublicationJournalManifest): void;
  commit<T>(operationId: string, write: () => T): T;
  finish(operationId: string): void;
  conflicts(refs: readonly RootFileRef[]): { operationId: string } | null;
  listUnfinished(): PublicationJournalRecord[];
}

export interface PublicationOutputPort {
  publicationSnapshot(query: { paths?: readonly string[]; kind?: string; includeOwners?: boolean }): {
    files: Array<RootFileRef & { itemId: string; fileId?: string; mediaIdentity?: string | null; size?: number }>;
    assets: Array<
      RootFileRef & { itemId: string; fileId: string | null; kind: string; published: boolean; historical: boolean }
    >;
  };
  registerPublishedOutputs(outputs: Array<RootFileRef & { itemId: string; fileId: string | null; kind: string }>): void;
  releaseOutputReferences(refs: RootFileRef[]): void;
}

export interface DurablePublicationContext {
  outputs?: PublicationOutputPort;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
}

export interface RegisteredPublicationContext extends DurablePublicationContext {
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
}

export interface PublishMediaOptions<TResult> extends DurablePublicationContext {
  ownerId?: string;
  validate?(): Promise<void> | void;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  commit(): TResult;
  download?(url: string): Promise<Uint8Array>;
  acquireAll?(refs: readonly RootFileRef[]): () => void;
  fileSystem?: PublicationFileSystem;
  logContext?: { runId?: string; itemId?: string };
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
