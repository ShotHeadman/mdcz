import { eq, inArray } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { maintenanceDirectoryTasks } from "./schema";

export class MaintenanceDirectoryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  save(input: {
    id: string;
    rootId: string;
    outputRootId: string;
    outputRelativeDirectory: string;
    presetId: string;
    scopeJson: string;
    configurationJson: string;
  }): void {
    const now = new Date();
    this.database.db
      .insert(maintenanceDirectoryTasks)
      .values({
        id: input.id,
        rootId: input.rootId,
        outputRootId: input.outputRootId,
        outputRelativeDirectory: input.outputRelativeDirectory,
        presetId: input.presetId,
        scopeJson: input.scopeJson,
        configurationJson: input.configurationJson,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  get(id: string) {
    const row = this.database.db
      .select()
      .from(maintenanceDirectoryTasks)
      .where(eq(maintenanceDirectoryTasks.id, id))
      .get();
    if (!row) throw new Error(`Maintenance directory task not found: ${id}`);
    return row;
  }

  setStatus(id: string, status: string): void {
    this.database.db
      .update(maintenanceDirectoryTasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(maintenanceDirectoryTasks.id, id))
      .run();
  }

  interruptUnfinished(): void {
    this.database.db
      .update(maintenanceDirectoryTasks)
      .set({ status: "interrupted", updatedAt: new Date() })
      .where(inArray(maintenanceDirectoryTasks.status, ["queued", "discovering", "running", "paused", "stopping"]))
      .run();
  }
}
