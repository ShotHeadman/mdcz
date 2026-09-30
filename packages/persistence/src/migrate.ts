import { existsSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const migrationFolderCandidates = [
  resolve(packageRoot, "drizzle"),
  resolve(process.cwd(), "apps/server/dist/persistence/drizzle"),
  resolve(process.cwd(), "dist/persistence/drizzle"),
  resolve(process.cwd(), "persistence/drizzle"),
];

export const defaultMigrationsFolder =
  migrationFolderCandidates.find((candidate) => existsSync(resolve(candidate, "meta/_journal.json"))) ??
  resolve(packageRoot, "drizzle");

export interface RunMigrationsConfig {
  migrationsFolder?: string;
}

export const runMigrations = (database: PersistenceDatabase, config: RunMigrationsConfig = {}): void => {
  const migrationsFolder = config.migrationsFolder ?? defaultMigrationsFolder;

  try {
    migrate(database.db, { migrationsFolder });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` | Caused by: ${error.cause.message}` : "";

    throw new PersistenceError(
      persistenceErrorCodes.MigrationFailed,
      `Failed to migrate persistence database "${database.sqlite.name}" from "${migrationsFolder}": ${reason}${cause}`,
      error,
    );
  }
};

export const migratePersistenceDatabase = (
  database: PersistenceDatabase,
  migrationsFolder = defaultMigrationsFolder,
): void => {
  runMigrations(database, { migrationsFolder });
};

// Only schema-level failures (unknown migration lineage, constraint conflicts) are fixed by starting over;
// busy, I/O and permission errors would recur on a fresh file or mean another process still owns it.
export const isSchemaMigrationFailure = (error: unknown): error is PersistenceError => {
  if (!(error instanceof PersistenceError) || error.code !== persistenceErrorCodes.MigrationFailed) return false;
  for (let cause = error.cause; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof Database.SqliteError) {
      return cause.code === "SQLITE_ERROR" || cause.code.startsWith("SQLITE_CONSTRAINT");
    }
  }
  return false;
};

export const moveDatabaseAside = (databasePath: string): string => {
  const backupPath = `${databasePath}.bak-${Date.now()}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(`${databasePath}${suffix}`)) renameSync(`${databasePath}${suffix}`, `${backupPath}${suffix}`);
  }
  return backupPath;
};
