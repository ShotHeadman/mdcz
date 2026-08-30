import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { manifestRefs, parsePublicationJournalManifest } from "./manifest";
import type {
  PublicationJournalManifest,
  PublicationJournalPort,
  PublicationJournalRecord,
  PublicationJournalState,
} from "./types";

export interface RawPublicationJournalRecord {
  operationId: string;
  operationType: string;
  state: PublicationJournalState;
  manifest: unknown;
  createdAt: Date;
}

export interface RawPublicationJournal {
  begin(entry: { operationId: string; operationType: string; manifest: unknown; createdAt: Date }): void;
  commit<T>(operationId: string, write: () => T): T;
  finish(operationId: string): void;
  listUnfinished(): RawPublicationJournalRecord[];
}

export class PublicationJournalAdapter implements PublicationJournalPort {
  private invalid: Array<{ operationId: string; operationType: string }> = [];

  constructor(private readonly raw: RawPublicationJournal) {}

  invalidManifests(): Array<{ operationId: string; operationType: string }> {
    return this.invalid;
  }

  begin(entry: {
    operationId: string;
    operationType: string;
    manifest: PublicationJournalManifest;
    createdAt: Date;
  }): void {
    this.raw.begin(entry);
  }

  commit<T>(operationId: string, write: () => T): T {
    return this.raw.commit(operationId, write);
  }

  finish(operationId: string): void {
    this.raw.finish(operationId);
  }

  listUnfinished(): PublicationJournalRecord[] {
    this.invalid = [];
    const records: PublicationJournalRecord[] = [];
    for (const entry of this.raw.listUnfinished()) {
      try {
        records.push({ ...entry, manifest: parsePublicationJournalManifest(entry.manifest) });
      } catch {
        this.invalid.push({ operationId: entry.operationId, operationType: entry.operationType });
      }
    }
    return records;
  }

  conflicts(refs: readonly RootFileRef[]): { operationId: string } | null {
    const requested = new Set(refs.map((ref) => `${ref.rootId}\0${ref.relativePath}`));
    return (
      this.listUnfinished().find((entry) =>
        manifestRefs(entry.manifest).some((ref) => requested.has(`${ref.rootId}\0${ref.relativePath}`)),
      ) ?? null
    );
  }
}

export const adaptPublicationJournal = (raw: RawPublicationJournal): PublicationJournalAdapter =>
  new PublicationJournalAdapter(raw);
