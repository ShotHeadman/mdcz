import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuntimeLogger } from "../shared";
import { noopRuntimeLogger, toErrorMessage } from "../shared";

export interface CooldownEntry {
  failureCount: number;
  lastFailureAt: number;
  cooldownUntil: number | null;
  expiresAt: number | null;
}

export interface CooldownFailurePolicy {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
}

export interface ActiveCooldown {
  failureCount: number;
  lastFailureAt: number;
  cooldownUntil: number;
  remainingMs: number;
}

export interface PersistentCooldownStoreOptions {
  filePath: string;
  logger?: Pick<RuntimeLogger, "warn">;
  persistDelayMs?: number;
}

const DEFAULT_PERSIST_DELAY_MS = 250;

const normalizeEntry = (value: unknown): CooldownEntry | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<CooldownEntry>;
  if (
    typeof candidate.failureCount !== "number" ||
    !Number.isFinite(candidate.failureCount) ||
    candidate.failureCount < 0 ||
    typeof candidate.lastFailureAt !== "number" ||
    !Number.isFinite(candidate.lastFailureAt) ||
    candidate.lastFailureAt < 0
  ) {
    return null;
  }

  const cooldownUntil =
    typeof candidate.cooldownUntil === "number" &&
    Number.isFinite(candidate.cooldownUntil) &&
    candidate.cooldownUntil > 0
      ? candidate.cooldownUntil
      : null;
  const expiresAt =
    typeof candidate.expiresAt === "number" && Number.isFinite(candidate.expiresAt) && candidate.expiresAt > 0
      ? candidate.expiresAt
      : cooldownUntil;

  return {
    failureCount: Math.trunc(candidate.failureCount),
    lastFailureAt: Math.trunc(candidate.lastFailureAt),
    cooldownUntil: cooldownUntil ? Math.trunc(cooldownUntil) : null,
    expiresAt: expiresAt ? Math.trunc(expiresAt) : null,
  };
};

export class PersistentCooldownStore {
  private readonly logger: Pick<RuntimeLogger, "warn">;
  private readonly filePath: string;
  private readonly persistDelayMs: number;
  private readonly entries = new Map<string, CooldownEntry>();
  private dirty = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private writePromise = Promise.resolve();

  constructor(options: PersistentCooldownStoreOptions) {
    this.logger = options.logger ?? noopRuntimeLogger;
    this.filePath = options.filePath;
    this.persistDelayMs = Math.max(0, Math.trunc(options.persistDelayMs ?? DEFAULT_PERSIST_DELAY_MS));
    this.loadFromDisk();
  }

  isCoolingDown(key: string, now = Date.now()): boolean {
    return this.get(key, now)?.cooldownUntil != null;
  }

  get(key: string, now = Date.now()): CooldownEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry, now)) {
      this.entries.delete(key);
      this.schedulePersist();
      return undefined;
    }
    return { ...entry };
  }

  getActiveCooldown(key: string, now = Date.now()): ActiveCooldown | undefined {
    const entry = this.get(key, now);
    if (!entry?.cooldownUntil) return undefined;
    const remainingMs = Math.max(0, entry.cooldownUntil - now);
    if (remainingMs <= 0) return undefined;
    return { ...entry, cooldownUntil: entry.cooldownUntil, remainingMs };
  }

  update(
    key: string,
    updater: (current: CooldownEntry | undefined, now: number) => CooldownEntry | undefined,
  ): CooldownEntry | undefined {
    const now = Date.now();
    const current = this.get(key, now);
    const next = updater(current, now);
    if (!next) {
      if (this.entries.delete(key)) this.schedulePersist();
      return undefined;
    }
    this.entries.set(key, { ...next });
    if (!current || !this.isSameEntry(current, next)) this.schedulePersist();
    return { ...next };
  }

  open(key: string, cooldownMs: number, failureCount = 1): CooldownEntry {
    const normalizedCooldownMs = Math.max(1, Math.trunc(cooldownMs));
    const normalizedFailureCount = Math.max(1, Math.trunc(failureCount));
    return this.requireEntry(
      this.update(key, (_current, now) => ({
        failureCount: normalizedFailureCount,
        lastFailureAt: now,
        cooldownUntil: now + normalizedCooldownMs,
        expiresAt: now + normalizedCooldownMs,
      })),
      "open",
      key,
    );
  }

  recordFailure(key: string, policy: CooldownFailurePolicy): CooldownEntry {
    const threshold = Math.max(1, Math.trunc(policy.threshold));
    const windowMs = Math.max(1, Math.trunc(policy.windowMs));
    const cooldownMs = Math.max(1, Math.trunc(policy.cooldownMs));
    return this.requireEntry(
      this.update(key, (current, now) => {
        const recentFailureCount = current && now - current.lastFailureAt <= windowMs ? current.failureCount : 0;
        const failureCount = recentFailureCount + 1;
        return {
          failureCount,
          lastFailureAt: now,
          cooldownUntil: failureCount >= threshold ? now + cooldownMs : null,
          expiresAt: failureCount >= threshold ? now + cooldownMs : now + windowMs,
        };
      }),
      "recordFailure",
      key,
    );
  }

  reset(key: string): void {
    if (this.entries.delete(key)) this.schedulePersist();
  }

  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    this.clearPersistTimer();
    this.queuePersistIfDirty();
    await this.writePromise;
  }

  private requireEntry(entry: CooldownEntry | undefined, operation: string, key: string): CooldownEntry {
    if (!entry) throw new Error(`PersistentCooldownStore.${operation} produced no entry for ${key}`);
    return entry;
  }

  private isSameEntry(left: CooldownEntry, right: CooldownEntry): boolean {
    return (
      left.failureCount === right.failureCount &&
      left.lastFailureAt === right.lastFailureAt &&
      left.cooldownUntil === right.cooldownUntil &&
      left.expiresAt === right.expiresAt
    );
  }

  private isExpired(entry: CooldownEntry, now: number): boolean {
    if (entry.expiresAt !== null) return entry.expiresAt <= now;
    return entry.cooldownUntil !== null && entry.cooldownUntil <= now;
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, unknown>;
      const now = Date.now();
      for (const [key, value] of Object.entries(parsed)) {
        const entry = normalizeEntry(value);
        if (!entry || (entry.cooldownUntil === null && entry.expiresAt === null) || this.isExpired(entry, now))
          continue;
        this.entries.set(key, entry);
      }
    } catch (error) {
      this.logger.warn(`Failed to load cooldown store ${this.filePath}: ${toErrorMessage(error)}`);
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persistDelayMs === 0) {
      this.queuePersistIfDirty();
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.queuePersistIfDirty();
    }, this.persistDelayMs);
  }

  private clearPersistTimer(): void {
    if (!this.persistTimer) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  private queuePersistIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.writePromise = this.writePromise
      .then(() => this.persist())
      .catch((error) => {
        this.logger.warn(`Failed to persist cooldown store ${this.filePath}: ${toErrorMessage(error)}`);
      });
  }

  private async persist(): Promise<void> {
    const payload = Object.fromEntries(
      [...this.entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value]),
    );
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
