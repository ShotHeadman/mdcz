import { eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { folderWatchSnapshots } from "./schema";

export class FolderWatchRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  load(scopeKey: string): Set<string> | undefined {
    const row = this.database.db
      .select({ fileKeysJson: folderWatchSnapshots.fileKeysJson })
      .from(folderWatchSnapshots)
      .where(eq(folderWatchSnapshots.scopeKey, scopeKey))
      .get();
    return row ? new Set(JSON.parse(row.fileKeysJson) as string[]) : undefined;
  }

  // Only one media directory is watched at a time, so snapshots of previously watched directories are dropped.
  save(scopeKey: string, fileKeys: ReadonlySet<string>): void {
    this.database.sqlite.transaction(() => {
      this.database.db.delete(folderWatchSnapshots).run();
      this.database.db
        .insert(folderWatchSnapshots)
        .values({ scopeKey, fileKeysJson: JSON.stringify([...fileKeys]) })
        .run();
    })();
  }
}
