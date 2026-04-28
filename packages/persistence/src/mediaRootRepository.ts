import type { MediaRoot } from "@mdcz/storage";
import { eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { type MediaRootRow, mediaRoots } from "./schema";

const toMediaRoot = (row: MediaRootRow): MediaRoot => ({
  id: row.id,
  displayName: row.displayName,
  hostPath: row.hostPath,
  rootType: "mounted-filesystem",
  enabled: row.enabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class MediaRootRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsert(root: MediaRoot): Promise<MediaRoot> {
    this.database.db
      .insert(mediaRoots)
      .values(root)
      .onConflictDoUpdate({
        target: mediaRoots.id,
        set: {
          displayName: root.displayName,
          hostPath: root.hostPath,
          rootType: root.rootType,
          enabled: root.enabled,
          updatedAt: root.updatedAt,
        },
      })
      .run();

    return root;
  }

  async list(): Promise<MediaRoot[]> {
    const rows = this.database.db.select().from(mediaRoots).orderBy(mediaRoots.displayName).all();
    return rows.map(toMediaRoot);
  }

  async get(id: string): Promise<MediaRoot> {
    const row = this.database.db.select().from(mediaRoots).where(eq(mediaRoots.id, id)).limit(1).get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Media root not found: ${id}`);
    }
    return toMediaRoot(row);
  }
}
