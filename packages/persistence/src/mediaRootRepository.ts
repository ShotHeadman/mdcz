import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  createMediaRoot,
  deterministicMediaRootId,
  filesystemPathKey,
  findEnclosingMediaRoot,
  isPathInside,
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
  realPath: row.realPath,
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
        realPath: root.realPath,
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
    const canonicalPath = await realpath(normalizedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (canonicalPath !== null && !(await stat(canonicalPath)).isDirectory())
      throw new Error(`Media root is not a directory: ${hostPath}`);
    for (const root of await this.list()) {
      if (root.realPath !== null) continue;
      try {
        const canonical = await realpath(root.hostPath);
        await this.upsert({ ...root, realPath: canonical });
      } catch (error) {
        if (
          !["ENOENT", "ENODEV", "ENOTCONN", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
    const transaction = this.database.sqlite.transaction(() => {
      const roots = this.database.db.select().from(mediaRoots).all().map(toMediaRoot);
      const equivalent =
        canonicalPath === null
          ? undefined
          : roots.find(
              (root) => root.realPath !== null && filesystemPathKey(root.realPath) === filesystemPathKey(canonicalPath),
            );
      if (equivalent) return equivalent;
      const enclosing = findEnclosingMediaRoot(
        normalizedPath,
        roots.filter(
          (root) => canonicalPath === null || (root.realPath !== null && isPathInside(root.realPath, canonicalPath)),
        ),
      );
      if (enclosing) return enclosing;
      const root = createMediaRoot({
        id: deterministicMediaRootId(normalizedPath),
        displayName: displayName ?? (path.basename(normalizedPath) || normalizedPath),
        hostPath: normalizedPath,
        realPath: canonicalPath,
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
