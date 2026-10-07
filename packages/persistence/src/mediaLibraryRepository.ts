import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { libraryWatchSnapshots, type MediaLibraryRow, mediaLibraries } from "./schema";

export type MediaLibraryRecord = MediaLibraryRow;
export type MediaLibraryValues = Omit<MediaLibraryRow, "id" | "createdAt" | "updatedAt">;

export class MediaLibraryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  list(): MediaLibraryRecord[] {
    return this.database.db.select().from(mediaLibraries).orderBy(asc(mediaLibraries.createdAt)).all();
  }

  get(id: string): MediaLibraryRecord {
    const row = this.database.db.select().from(mediaLibraries).where(eq(mediaLibraries.id, id)).get();
    if (!row) throw new PersistenceError(persistenceErrorCodes.NotFound, `Library not found: ${id}`);
    return row;
  }

  create(values: MediaLibraryValues, now = new Date()): MediaLibraryRecord {
    const row = { ...values, id: randomUUID(), createdAt: now, updatedAt: now };
    this.database.db.insert(mediaLibraries).values(row).run();
    return row;
  }

  update(id: string, values: MediaLibraryValues, now = new Date()): MediaLibraryRecord {
    const current = this.get(id);
    const row = { ...current, ...values, updatedAt: now };
    this.database.sqlite.transaction(() => {
      this.database.db.update(mediaLibraries).set(row).where(eq(mediaLibraries.id, id)).run();
      // A different source directory makes the old snapshot meaningless; the next scan sets a new baseline.
      if (current.sourcePath !== values.sourcePath)
        this.database.db.delete(libraryWatchSnapshots).where(eq(libraryWatchSnapshots.libraryId, id)).run();
    })();
    return row;
  }

  delete(id: string): void {
    this.database.db.delete(mediaLibraries).where(eq(mediaLibraries.id, id)).run();
  }

  loadWatchSnapshot(libraryId: string): Set<string> | undefined {
    const row = this.database.db
      .select({ fileKeysJson: libraryWatchSnapshots.fileKeysJson })
      .from(libraryWatchSnapshots)
      .where(eq(libraryWatchSnapshots.libraryId, libraryId))
      .get();
    return row ? new Set(JSON.parse(row.fileKeysJson) as string[]) : undefined;
  }

  saveWatchSnapshot(libraryId: string, fileKeys: ReadonlySet<string>): void {
    const fileKeysJson = JSON.stringify([...fileKeys]);
    this.database.db
      .insert(libraryWatchSnapshots)
      .values({ libraryId, fileKeysJson })
      .onConflictDoUpdate({ target: libraryWatchSnapshots.libraryId, set: { fileKeysJson } })
      .run();
  }
}
