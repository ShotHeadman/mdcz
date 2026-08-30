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

const toEntry = (row: PublicationJournalRow): PublicationJournalEntry => ({
  operationId: row.operationId,
  operationType: row.operationType,
  state: row.state,
  manifest: JSON.parse(row.manifestJson),
  createdAt: row.createdAt,
});

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
}
