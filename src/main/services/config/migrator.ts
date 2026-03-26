/**
 * Configuration migration executor.
 *
 * Reads `configVersion` from a raw config object, runs all pending migrations
 * in order, and returns the result with metadata about what was applied.
 */
import { migrations } from "./migrations";

export const CURRENT_CONFIG_VERSION = 3;

export class ConfigMigrationError extends Error {
  constructor(
    readonly code: "CONFIG_VERSION_UNSUPPORTED" | "CONFIG_MIGRATION_CHAIN_INCOMPLETE",
    message: string,
  ) {
    super(message);
  }
}

export interface MigrationResult {
  /** Whether any migrations were executed. */
  migrated: boolean;
  /** The configVersion before migration. */
  fromVersion: number;
  /** The configVersion after migration. */
  toVersion: number;
  /** Descriptions of applied migrations. */
  applied: string[];
}

/**
 * Run all pending migrations on a raw config object **in place**.
 *
 * After this function returns, the raw object has been mutated to match
 * the latest config structure. Callers should still run `configurationSchema.parse()`
 * on the result to fill in any new defaults and strip unknown fields.
 */
export function runMigrations(raw: Record<string, unknown>): MigrationResult {
  const fromVersion = typeof raw.configVersion === "number" ? raw.configVersion : 0;
  if (fromVersion > CURRENT_CONFIG_VERSION) {
    throw new ConfigMigrationError(
      "CONFIG_VERSION_UNSUPPORTED",
      `Config version ${fromVersion} is newer than supported version ${CURRENT_CONFIG_VERSION}`,
    );
  }

  let currentVersion = fromVersion;
  const applied: string[] = [];

  const migrationMap = new Map(migrations.map((migration) => [migration.fromVersion, migration]));

  while (currentVersion < CURRENT_CONFIG_VERSION) {
    const migration = migrationMap.get(currentVersion);
    if (!migration) {
      throw new ConfigMigrationError(
        "CONFIG_MIGRATION_CHAIN_INCOMPLETE",
        `No config migration found from version ${currentVersion} to ${CURRENT_CONFIG_VERSION}`,
      );
    }

    migration.migrate(raw);
    applied.push(migration.description);
    if (migration.toVersion <= currentVersion) {
      throw new ConfigMigrationError(
        "CONFIG_MIGRATION_CHAIN_INCOMPLETE",
        `Invalid config migration step ${migration.fromVersion} -> ${migration.toVersion}`,
      );
    }
    currentVersion = migration.toVersion;
  }

  raw.configVersion = currentVersion;

  return {
    migrated: applied.length > 0,
    fromVersion,
    toVersion: currentVersion,
    applied,
  };
}
