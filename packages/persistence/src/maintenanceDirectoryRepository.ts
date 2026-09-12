import { desc, eq, ne } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { maintenanceDirectoryTasks } from "./schema";

export interface MaintenanceDirectoryRecord {
  id: string;
  snapshotJson: string;
  configurationJson: string;
}

export class MaintenanceDirectoryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  save(record: MaintenanceDirectoryRecord): void {
    this.database.sqlite.transaction(() => {
      this.database.db.delete(maintenanceDirectoryTasks).where(ne(maintenanceDirectoryTasks.id, record.id)).run();
      const values = { ...record, updatedAt: new Date() };
      this.database.db
        .insert(maintenanceDirectoryTasks)
        .values(values)
        .onConflictDoUpdate({ target: maintenanceDirectoryTasks.id, set: values })
        .run();
    })();
  }

  latest(): MaintenanceDirectoryRecord | null {
    return (
      this.database.db
        .select()
        .from(maintenanceDirectoryTasks)
        .orderBy(desc(maintenanceDirectoryTasks.updatedAt))
        .get() ?? null
    );
  }

  discard(id: string): void {
    this.database.db.delete(maintenanceDirectoryTasks).where(eq(maintenanceDirectoryTasks.id, id)).run();
  }
}
