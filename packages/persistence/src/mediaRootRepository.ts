import path from "node:path";
import {
  createMediaRoot,
  deterministicMediaRootId,
  findEnclosingMediaRoot,
  type MediaRoot,
  normalizeHostPath,
} from "@mdcz/media-store";
import { eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { type MediaRootRow, mediaRoots } from "./schema";

export type PersistedMediaRoot = MediaRoot;

const toMediaRoot = (row: MediaRootRow): PersistedMediaRoot => ({
  id: row.id,
  displayName: row.displayName,
  hostPath: row.hostPath,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const writeMediaRoot = (database: PersistenceDatabase, root: MediaRoot): void => {
  database.db
    .insert(mediaRoots)
    .values(root)
    .onConflictDoUpdate({
      target: mediaRoots.id,
      set: {
        displayName: root.displayName,
        hostPath: root.hostPath,
        updatedAt: root.updatedAt,
      },
    })
    .run();
};

export class MediaRootRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsert(root: MediaRoot): Promise<PersistedMediaRoot> {
    writeMediaRoot(this.database, root);

    return root;
  }

  async ensurePath(hostPath: string, displayName?: string): Promise<PersistedMediaRoot> {
    const normalizedPath = normalizeHostPath(hostPath);
    const transaction = this.database.sqlite.transaction(() => {
      const roots = this.database.db.select().from(mediaRoots).all().map(toMediaRoot);
      const enclosing = findEnclosingMediaRoot(normalizedPath, roots);
      if (enclosing) return enclosing;
      const root = createMediaRoot({
        id: deterministicMediaRootId(normalizedPath),
        displayName: displayName ?? (path.basename(normalizedPath) || normalizedPath),
        hostPath: normalizedPath,
      });
      writeMediaRoot(this.database, root);
      return root;
    });
    return transaction();
  }

  async list(): Promise<PersistedMediaRoot[]> {
    const rows = this.database.db.select().from(mediaRoots).orderBy(mediaRoots.displayName).all();
    return rows.map(toMediaRoot);
  }

  async get(id: string): Promise<PersistedMediaRoot> {
    const row = this.database.db.select().from(mediaRoots).where(eq(mediaRoots.id, id)).limit(1).get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Media root not found: ${id}`);
    }
    return toMediaRoot(row);
  }
}
