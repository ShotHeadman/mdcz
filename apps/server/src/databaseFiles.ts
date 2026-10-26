import { chmodSync, closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { moveDatabaseAside } from "@mdcz/persistence";
import Database from "better-sqlite3";

/** `nativeBinding` is the better-sqlite3 addon built for the host's ABI; Electron loads its own build. */
export const acquireDatabaseLease = (databasePath: string, nativeBinding?: string): Database.Database => {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  closeSync(openSync(databasePath, "a", 0o600));
  const canonicalPath = realpathSync(databasePath);
  chmodSync(canonicalPath, 0o600);
  const lockPath = `${canonicalPath}.lock.sqlite`;
  closeSync(openSync(lockPath, "a", 0o600));
  chmodSync(lockPath, 0o600);
  const lease = new Database(lockPath, { timeout: 0, nativeBinding });
  try {
    // A separate SQLite file holds an OS lock without blocking application WAL writes.
    // The OS releases it after a crash; never unlink this file while an instance runs.
    lease.pragma("journal_mode = DELETE");
    lease.exec("BEGIN EXCLUSIVE");
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${canonicalPath}${suffix}`)) chmodSync(`${canonicalPath}${suffix}`, 0o600);
    }
    return lease;
  } catch (error) {
    lease.close();
    throw new Error(
      `Cannot acquire database ownership for ${canonicalPath}; stop other MDCz instances before starting or restoring.`,
      { cause: error },
    );
  }
};

/** Renames the database to a backup beside itself, so the next start creates a new one; returns the backup path. */
export const rebuildDatabase = (databasePath: string, nativeBinding?: string): string => {
  const lease = acquireDatabaseLease(databasePath, nativeBinding);
  try {
    return moveDatabaseAside(realpathSync(databasePath));
  } finally {
    lease.close();
  }
};
