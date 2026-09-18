import { and, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { publicationJournal } from "./schema";

export type PublicationJournalState = "pending" | "committed";

export interface PublicationJournalEntry<TManifest = unknown> {
  operationId: string;
  operationType: string;
  state: PublicationJournalState;
  manifest: TManifest;
  createdAt: Date;
}

export type BeginPublicationJournalEntry<TManifest = unknown> = Omit<PublicationJournalEntry<TManifest>, "state">;

const parseManifest = (manifestJson: string): unknown => {
  try {
    return JSON.parse(manifestJson);
  } catch {
    return undefined;
  }
};

export class PublicationJournalRepository<TManifest = unknown> {
  private invalid: Array<{ operationId: string; operationType: string }> = [];

  constructor(
    private readonly database: PersistenceDatabase,
    private readonly parse: (value: unknown) => TManifest = (value) => value as TManifest,
  ) {}

  begin(entry: BeginPublicationJournalEntry<TManifest>): void {
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

  listUnfinished(): PublicationJournalEntry<TManifest>[] {
    this.invalid = [];
    return this.database.db
      .select()
      .from(publicationJournal)
      .all()
      .flatMap((row) => {
        try {
          return [
            {
              operationId: row.operationId,
              operationType: row.operationType,
              state: row.state,
              manifest: this.parse(parseManifest(row.manifestJson)),
              createdAt: row.createdAt,
            },
          ];
        } catch {
          this.invalid.push({ operationId: row.operationId, operationType: row.operationType });
          return [];
        }
      });
  }

  invalidManifests(): Array<{ operationId: string; operationType: string }> {
    return this.invalid;
  }
}
