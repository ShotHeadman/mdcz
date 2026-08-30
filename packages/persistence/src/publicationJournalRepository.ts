import { and, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { type PublicationJournalRow, publicationJournal } from "./schema";

export type PublicationJournalState = "pending" | "committed";

export interface PublicationJournalEntry {
  operationId: string;
  operationType: string;
  state: PublicationJournalState;
  manifest: unknown;
  createdAt: Date;
}

export type BeginPublicationJournalEntry = Omit<PublicationJournalEntry, "state">;

interface PublicationPathRef {
  rootId: string;
  relativePath: string;
}

const toEntry = (row: PublicationJournalRow): PublicationJournalEntry => ({
  operationId: row.operationId,
  operationType: row.operationType,
  state: row.state,
  manifest: JSON.parse(row.manifestJson),
  createdAt: row.createdAt,
});

const refsInManifest = (manifest: unknown): PublicationPathRef[] => {
  if (!manifest || typeof manifest !== "object") return [];
  const record = manifest as { entries?: unknown; obsolete?: unknown };
  const refs: PublicationPathRef[] = [];
  for (const list of [record.entries, record.obsolete]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as { rootId?: unknown; relativePath?: unknown };
      if (typeof candidate.rootId === "string" && typeof candidate.relativePath === "string") {
        refs.push({ rootId: candidate.rootId, relativePath: candidate.relativePath });
      }
    }
  }
  return refs;
};

export class PublicationJournalRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  begin(entry: BeginPublicationJournalEntry): void {
    this.database.db
      .insert(publicationJournal)
      .values({
        operationId: entry.operationId,
        operationType: entry.operationType,
        state: "pending",
        manifestJson: JSON.stringify(entry.manifest),
        createdAt: entry.createdAt,
      })
      .run();
  }

  commit<T>(operationId: string, write: () => T): T {
    return this.database.sqlite.transaction(() => {
      const result = write();
      const transition = this.database.db
        .update(publicationJournal)
        .set({ state: "committed" })
        .where(and(eq(publicationJournal.operationId, operationId), eq(publicationJournal.state, "pending")))
        .run();
      if (transition.changes !== 1) throw new Error(`Publication journal operation is not pending: ${operationId}`);
      return result;
    })();
  }

  finish(operationId: string): void {
    this.database.db.delete(publicationJournal).where(eq(publicationJournal.operationId, operationId)).run();
  }

  listUnfinished(): PublicationJournalEntry[] {
    return this.database.db.select().from(publicationJournal).all().map(toEntry);
  }

  conflicts(refs: readonly PublicationPathRef[]): PublicationJournalEntry | null {
    const requested = new Set(refs.map((ref) => `${ref.rootId}\0${ref.relativePath}`));
    return (
      this.listUnfinished().find((entry) =>
        refsInManifest(entry.manifest).some((ref) => requested.has(`${ref.rootId}\0${ref.relativePath}`)),
      ) ?? null
    );
  }
}
