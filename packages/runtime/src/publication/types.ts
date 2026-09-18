import type { Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublicationLibraryAsset } from "./outputLibrary";

export interface PublicationParticipants<TMember extends { source: RootFileRef } = { source: RootFileRef }> {
  movieId: string;
  members: Array<TMember & { fileId: string }>;
  expected: ReturnType<PublicationOutputPort["publicationSnapshot"]>;
}

export interface PublicationFileSystem {
  copyFile(source: string, target: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<Stats>;
  writeFile(path: string, data: Buffer | string, options?: { flush?: boolean }): Promise<void>;
  flush?(path: string): Promise<void>;
}

export interface PublicationRepairPort {
  record(input: {
    operationId: string;
    operationType: "scrape" | "maintenance";
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
  source: RootFileRef;
  rewritten?: boolean;
}

export interface PublicationJournalManifest {
  entries: PublicationJournalManifestEntry[];
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
  listUnfinished(): PublicationJournalRecord[];
  invalidManifests?(): Array<{ operationId: string; operationType: string }>;
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

export interface PublicationResult<TResult> {
  value: TResult;
  cleanupIssues: unknown[];
}
