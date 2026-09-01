import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
