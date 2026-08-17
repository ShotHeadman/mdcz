import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";

export interface PersistenceDatabaseConfig {
  path: string;
  readonly?: boolean;
  /**
   * Optional explicit path to the better_sqlite3.node native binding.
   * Used by the Electron main process to load an Electron-ABI prebuilt
   * binary kept separate from the hoisted Node-ABI copy in node_modules.
   */
  nativeBinding?: string;
}

export interface PersistenceDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export const createPersistenceDatabase = (config: PersistenceDatabaseConfig): PersistenceDatabase => {
  const sqlite = new Database(config.path, {
    readonly: config.readonly ?? false,
    ...(config.nativeBinding ? { nativeBinding: config.nativeBinding } : {}),
  });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
};
