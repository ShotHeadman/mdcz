import { randomUUID } from "node:crypto";
import { asc, eq, lt } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { apiKeys, authSessions } from "./schema";

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Only hashes are stored: a leaked database reveals no usable key or session token. */
export class CredentialRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  listApiKeys(): ApiKeyRecord[] {
    return this.database.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .orderBy(asc(apiKeys.createdAt))
      .all();
  }

  createApiKey(input: { name: string; prefix: string; keyHash: string }, now = new Date()): ApiKeyRecord {
    const row = { id: randomUUID(), ...input, createdAt: now, lastUsedAt: null };
    this.database.db.insert(apiKeys).values(row).run();
    return { id: row.id, name: row.name, prefix: row.prefix, createdAt: now, lastUsedAt: null };
  }

  deleteApiKey(id: string): void {
    this.database.db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
  }

  /** Marks the key used and reports whether it exists. */
  touchApiKey(keyHash: string, now = new Date()): boolean {
    return (
      this.database.db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.keyHash, keyHash)).run().changes > 0
    );
  }

  createSession(tokenHash: string, now = new Date()): void {
    this.database.db.insert(authSessions).values({ tokenHash, createdAt: now, lastSeenAt: now }).run();
  }

  /** Extends a live session; sessions idle since `expiredBefore` are removed and report false. */
  touchSession(tokenHash: string, expiredBefore: Date, now = new Date()): boolean {
    this.database.db.delete(authSessions).where(lt(authSessions.lastSeenAt, expiredBefore)).run();
    return (
      this.database.db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.tokenHash, tokenHash)).run()
        .changes > 0
    );
  }

  deleteSession(tokenHash: string): void {
    this.database.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash)).run();
  }
}
