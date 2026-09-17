import type { Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";

import type { CrawlerData, FileInfo, ScrapeResult, VideoMeta } from "@mdcz/shared/types";
import type { PublicationLibraryAsset } from "./libraryEntry";

export interface PublicationParticipants<TMember extends { source: RootFileRef } = { source: RootFileRef }> {
  movieId: string;
  members: Array<TMember & { fileId: string }>;
  expected: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
}

export type PublicationContent = { kind: "bytes"; data: Buffer } | { kind: "text"; data: string };

export type PublicationOperation = { target: RootFileRef; replaceExisting: boolean } & (
  | { kind: "copy"; sourcePath: string; size: number }
  | { kind: "move"; source: RootFileRef; size: number }
  | { kind: "write"; content: PublicationContent }
);

export interface PublicationFile {
  fileId: string;
  source: RootFileRef;
  target: RootFileRef;
  size: number;
  sourceSize: number;
  modifiedAt: Date;
  assets: AssetRef[];
  operations: PublicationOperation[];
  scrape?: {
    itemId: string;
    attemptId: string;
    identity: Pick<ScrapeResult, "rootId" | "relativePath" | "fileName" | "part">;
    fileInfo: FileInfo;
    videoMeta?: VideoMeta;
    error?: string;
    uncensoredAmbiguous: boolean;
  };
}

interface PublicationBase {
  operationId: string;
  operationType: "scrape" | "maintenance";
  operations: PublicationOperation[];
  movieAssets: AssetRef[];
  obsolete: RootFileRef[];
}

export interface MoviePublicationPlan extends PublicationBase {
  kind: "movie";
  movieId: string;
  files: PublicationFile[];
  expected: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
  scrape?: { crawlerData: CrawlerData; sources: ScrapeResult["sources"]; nfo?: RootFileRef };
}

export interface UnmanagedPublicationPlan extends PublicationBase {
  kind: "unmanaged";
  files: [];
  sources: Array<{ source: RootFileRef; size: number }>;
}

export type PublicationPlan = MoviePublicationPlan | UnmanagedPublicationPlan;

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
  listUnfinished(): PublicationJournalRecord[];
}

export interface PublicationOutputPort {
  publicationRoots(): Array<Pick<MediaRoot, "id" | "hostPath">>;
  publicationSnapshot(query: { paths?: readonly string[]; kind?: string; includeOwners?: boolean }): {
    files: Array<RootFileRef & { itemId: string; fileId?: string; mediaIdentity?: string | null; size?: number }>;
    assets: Array<
      RootFileRef & { itemId: string; fileId: string | null; kind: string; published: boolean; historical: boolean }
    >;
  };
}

export interface DurablePublicationContext {
  outputs?: PublicationOutputPort;
  journal: PublicationJournalPort;
  repairIssues?: PublicationRepairPort;
}

export interface RegisteredPublicationContext extends DurablePublicationContext {
  library?: {
    getEntryById(id: string): Promise<{
      assets: Array<PublicationLibraryAsset & { fileId: string | null; historical: boolean }>;
    }>;
    writeEntry(
      movie: { id: string; assets?: PublicationLibraryAsset[] },
      files: Array<{ fileId: string; rootId: string; rootRelativePath: string; assets?: PublicationLibraryAsset[] }>,
    ): string;
  };
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
}

export interface PublishMediaOptions<TResult> extends DurablePublicationContext {
  validate?(): Promise<void> | void;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  commit(): TResult;
  acquireAll?(keys: readonly string[]): () => void;
  fileSystem?: PublicationFileSystem;
  logContext?: { runId?: string; itemId?: string };
}

export interface PublicationResult<TResult> {
  value: TResult;
  cleanupIssues: unknown[];
}
