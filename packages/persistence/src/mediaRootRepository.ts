import type { MediaRoot } from "@mdcz/media-store";
import { and, eq, ne } from "drizzle-orm";
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

const writeMediaRoot = (database: PersistenceDatabase, root: MediaRoot & { deleted?: boolean }): void => {
  const deleted = root.deleted ?? false;
  database.db
    .insert(mediaRoots)
    .values({ ...root, enabled: deleted ? false : root.enabled, deleted })
    .onConflictDoUpdate({
      target: mediaRoots.id,
      set: {
        displayName: root.displayName,
        hostPath: root.hostPath,
        rootType: root.rootType,
        enabled: deleted ? false : root.enabled,
        deleted,
        updatedAt: root.updatedAt,
      },
    })
    .run();
};

export class MediaRootRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsert(root: MediaRoot & { deleted?: boolean }): Promise<PersistedMediaRoot> {
    writeMediaRoot(this.database, root);

    const deleted = root.deleted ?? false;
    return { ...root, enabled: deleted ? false : root.enabled, deleted };
  }

  async activateExclusive(
    root: MediaRoot,
    options: { exemptRootIds?: readonly string[] } = {},
  ): Promise<PersistedMediaRoot> {
    const rootToActivate = { ...root, enabled: true, deleted: false };
    const exemptRootIds = new Set([rootToActivate.id, ...(options.exemptRootIds ?? [])]);
    const transaction = this.database.sqlite.transaction(() => {
      writeMediaRoot(this.database, rootToActivate);
      this.database.db
        .update(mediaRoots)
        .set({ enabled: false, updatedAt: rootToActivate.updatedAt })
        .where(
          and(
            eq(mediaRoots.enabled, true),
            eq(mediaRoots.deleted, false),
            ...[...exemptRootIds].map((id) => ne(mediaRoots.id, id)),
          ),
        )
        .run();
    });
    transaction();
    return await this.get(rootToActivate.id);
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
