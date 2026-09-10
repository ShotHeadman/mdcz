import { chmodSync, closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export const acquireDatabaseLease = (databasePath: string): Database.Database => {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  closeSync(openSync(databasePath, "a", 0o600));
  const canonicalPath = realpathSync(databasePath);
  chmodSync(canonicalPath, 0o600);
  const lockPath = `${canonicalPath}.lock.sqlite`;
  closeSync(openSync(lockPath, "a", 0o600));
  chmodSync(lockPath, 0o600);
  const lease = new Database(lockPath, { timeout: 0 });
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
