import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";

export interface PersistenceDatabaseConfig {
  path: string;
  readonly?: boolean;
}

export interface PersistenceDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export const createPersistenceDatabase = (config: PersistenceDatabaseConfig): PersistenceDatabase => {
  const sqlite = new Database(config.path, { readonly: config.readonly ?? false });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
};
