import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { libraryRepairIssues } from "./schema";

export type LibraryRepairOperationType = "scrape" | "maintenance";

export interface LibraryRepairIssue {
  id: string;
  operationId: string;
  operationType: LibraryRepairOperationType;
  rootId: string;
  relativePath: string;
  errorMessage: string;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export class LibraryRepairIssueRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  listUnresolved(): LibraryRepairIssue[] {
    return this.database.db
      .select()
      .from(libraryRepairIssues)
      .where(isNull(libraryRepairIssues.resolvedAt))
      .orderBy(asc(libraryRepairIssues.detectedAt))
      .all();
  }
  countUnresolved(): number {
    return (
      this.database.db
        .select({ count: count() })
        .from(libraryRepairIssues)
        .where(isNull(libraryRepairIssues.resolvedAt))
        .get()?.count ?? 0
    );
  }

  record(input: Omit<LibraryRepairIssue, "id" | "detectedAt" | "resolvedAt">, detectedAt = new Date()): void {
    this.database.db
      .insert(libraryRepairIssues)
      .values({ id: randomUUID(), ...input, detectedAt, resolvedAt: null })
      .onConflictDoUpdate({
        target: [libraryRepairIssues.operationId, libraryRepairIssues.rootId, libraryRepairIssues.relativePath],
        set: { operationType: input.operationType, errorMessage: input.errorMessage, detectedAt, resolvedAt: null },
      })
      .run();
  }

  resolve(operationId: string, rootId: string, relativePath: string, resolvedAt = new Date()): void {
    this.database.db
      .update(libraryRepairIssues)
      .set({ resolvedAt })
      .where(
        and(
          eq(libraryRepairIssues.operationId, operationId),
          eq(libraryRepairIssues.rootId, rootId),
          eq(libraryRepairIssues.relativePath, relativePath),
        ),
      )
      .run();
  }
}
