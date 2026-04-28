import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const defaultMigrationsFolder = resolve(packageRoot, "drizzle");

export interface RunMigrationsConfig {
  migrationsFolder?: string;
}

export const runMigrations = (database: PersistenceDatabase, config: RunMigrationsConfig = {}): void => {
  try {
    migrate(database.db, { migrationsFolder: config.migrationsFolder ?? defaultMigrationsFolder });
  } catch (error) {
    throw new PersistenceError(persistenceErrorCodes.MigrationFailed, "Failed to migrate persistence database", error);
  }
};

export const migratePersistenceDatabase = (
  database: PersistenceDatabase,
  migrationsFolder = defaultMigrationsFolder,
): void => {
  runMigrations(database, { migrationsFolder });
};
