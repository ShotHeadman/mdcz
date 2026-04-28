import { createPersistenceDatabase, type PersistenceDatabase } from "./database";
import { runMigrations } from "./migrate";

export const createTestPersistenceDatabase = (): PersistenceDatabase => {
  const database = createPersistenceDatabase({ path: ":memory:" });
  runMigrations(database);

  return database;
};
