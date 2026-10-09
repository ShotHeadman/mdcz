import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import type { LibraryFileInput, LibraryMovieInput } from "./libraryRepository";
import { writeLibraryRows } from "./libraryWrite";
import { type PendingItemRow, type PendingKind, pendingItems } from "./schema";

export type PendingItemRecord = PendingItemRow;

export interface PendingItemInput {
  kind: PendingKind;
  rootId: string;
  relativePath: string;
  libraryId?: string | null;
  movieId?: string | null;
  number?: string | null;
  detail?: string | null;
  candidatesJson?: string | null;
}

export class PendingRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  list(): PendingItemRecord[] {
    return this.database.db.select().from(pendingItems).orderBy(desc(pendingItems.updatedAt)).all();
  }

  count(): number {
    return this.database.db.select({ count: sql<number>`count(*)` }).from(pendingItems).get()?.count ?? 0;
  }

  get(id: string): PendingItemRecord {
    const row = this.database.db.select().from(pendingItems).where(eq(pendingItems.id, id)).get();
    if (!row) throw new PersistenceError(persistenceErrorCodes.NotFound, `Pending item not found: ${id}`);
    return row;
  }

  /** One entry per source file: a newer outcome replaces the previous one. Returns whether the entry is new. */
  upsert(input: PendingItemInput, now = new Date()): boolean {
    const values = {
      kind: input.kind,
      libraryId: input.libraryId ?? null,
      movieId: input.movieId ?? null,
      number: input.number ?? null,
      detail: input.detail ?? null,
      candidatesJson: input.candidatesJson ?? null,
      updatedAt: now,
    };
    const existing = this.database.db
      .select({ id: pendingItems.id })
      .from(pendingItems)
      .where(and(eq(pendingItems.rootId, input.rootId), eq(pendingItems.relativePath, input.relativePath)))
      .get();
    if (existing) {
      this.database.db.update(pendingItems).set(values).where(eq(pendingItems.id, existing.id)).run();
      return false;
    }
    this.database.db
      .insert(pendingItems)
      .values({
        ...values,
        id: randomUUID(),
        rootId: input.rootId,
        relativePath: input.relativePath,
        createdAt: now,
      })
      .run();
    return true;
  }

  delete(ids: readonly string[]): void {
    if (ids.length)
      this.database.db
        .delete(pendingItems)
        .where(inArray(pendingItems.id, [...ids]))
        .run();
  }

  /** Publishes a movie and settles its pending entries together, so a failure leaves neither half behind. */
  commitPublication(
    movie: LibraryMovieInput,
    files: readonly LibraryFileInput[],
    pending: {
      clearFiles: readonly { rootId: string; relativePath: string }[];
      uncensored?: Omit<PendingItemInput, "kind" | "movieId">;
    },
  ): { movieId: string; uncensoredAdded: boolean } {
    return this.database.sqlite.transaction(() => {
      const movieId = writeLibraryRows(this.database, movie, files);
      this.deleteFiles(pending.clearFiles);
      const uncensoredAdded = pending.uncensored
        ? this.upsert({ ...pending.uncensored, kind: "uncensored", movieId })
        : false;
      return { movieId, uncensoredAdded };
    })();
  }

  confirmUncensored(id: string, movie: LibraryMovieInput, files: readonly LibraryFileInput[]): void {
    this.database.sqlite.transaction(() => {
      const pending = this.get(id);
      if (pending.kind !== "uncensored" || pending.movieId !== movie.id)
        throw new Error("Pending confirmation no longer matches this movie");
      writeLibraryRows(this.database, movie, files);
      this.delete([id]);
    })();
  }

  deleteFiles(refs: readonly { rootId: string; relativePath: string }[]): void {
    if (!refs.length) return;
    this.database.sqlite
      .prepare<[string]>(`
        DELETE FROM pending_items WHERE (root_id, relative_path) IN (
          SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)
        )
      `)
      .run(JSON.stringify(refs.map((ref) => [ref.rootId, ref.relativePath])));
  }

  deleteForMovie(movieId: string, kind?: PendingKind): void {
    this.database.db
      .delete(pendingItems)
      .where(
        kind ? and(eq(pendingItems.movieId, movieId), eq(pendingItems.kind, kind)) : eq(pendingItems.movieId, movieId),
      )
      .run();
  }
}
