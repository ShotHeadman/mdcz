import type { MediaRoot } from "@mdcz/storage";
import { and, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { type MediaRootRow, mediaRoots } from "./schema";

export interface PersistedMediaRoot extends MediaRoot {
  deleted: boolean;
}

const toMediaRoot = (row: MediaRootRow): PersistedMediaRoot => ({
  id: row.id,
  displayName: row.displayName,
  hostPath: row.hostPath,
  rootType: "mounted-filesystem",
  enabled: row.enabled,
  deleted: row.deleted,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class MediaRootRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsert(root: MediaRoot & { deleted?: boolean }): Promise<PersistedMediaRoot> {
    this.database.db
      .insert(mediaRoots)
      .values({ ...root, deleted: root.deleted ?? false })
      .onConflictDoUpdate({
        target: mediaRoots.id,
        set: {
          displayName: root.displayName,
          hostPath: root.hostPath,
          rootType: root.rootType,
          enabled: root.enabled,
          deleted: root.deleted ?? false,
          updatedAt: root.updatedAt,
        },
      })
      .run();

    return { ...root, deleted: root.deleted ?? false };
  }

  async list(options: { includeDeleted?: boolean } = {}): Promise<PersistedMediaRoot[]> {
    const rows = options.includeDeleted
      ? this.database.db.select().from(mediaRoots).orderBy(mediaRoots.displayName).all()
      : this.database.db
          .select()
          .from(mediaRoots)
          .where(eq(mediaRoots.deleted, false))
          .orderBy(mediaRoots.displayName)
          .all();
    return rows.map(toMediaRoot);
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<PersistedMediaRoot> {
    const where = options.includeDeleted
      ? eq(mediaRoots.id, id)
      : and(eq(mediaRoots.id, id), eq(mediaRoots.deleted, false));
    const row = this.database.db.select().from(mediaRoots).where(where).limit(1).get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Media root not found: ${id}`);
    }
    return toMediaRoot(row);
  }
}
