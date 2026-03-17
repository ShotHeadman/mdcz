import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { app } from "electron";

export interface CooldownEntry {
  failureCount: number;
  lastFailureAt: number;
  cooldownUntil: number | null;
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

interface PersistentCooldownStoreOptions {
  fileName?: string;
  filePath?: string;
  loggerName?: string;
}

const DEFAULT_FILE_NAME = "cooldowns.json";

const resolveStorePath = (fileName: string): string => {
  try {
    return join(app.getPath("userData"), fileName);
  } catch {
    return join(process.cwd(), ".tmp", fileName);
  }
};

const normalizeEntry = (value: unknown): CooldownEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

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

  return {
    failureCount: Math.trunc(candidate.failureCount),
    lastFailureAt: Math.trunc(candidate.lastFailureAt),
    cooldownUntil: cooldownUntil ? Math.trunc(cooldownUntil) : null,
  };
};

export class PersistentCooldownStore {
  private readonly logger: ReturnType<typeof loggerService.getLogger>;

  private readonly filePath: string;

  private readonly entries = new Map<string, CooldownEntry>();

  private persistQueued = false;

  private writePromise = Promise.resolve();

  constructor(options: PersistentCooldownStoreOptions = {}) {
    this.logger = loggerService.getLogger(options.loggerName ?? "PersistentCooldownStore");
    this.filePath = options.filePath ?? resolveStorePath(options.fileName ?? DEFAULT_FILE_NAME);
    this.loadFromDisk();
  }

  isCoolingDown(key: string, now = Date.now()): boolean {
    const entry = this.get(key, now);
    return entry !== undefined && entry.cooldownUntil !== null;
  }

  get(key: string, now = Date.now()): CooldownEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.cooldownUntil !== null && entry.cooldownUntil <= now) {
      this.entries.delete(key);
      this.schedulePersist();
      return undefined;
    }

    return { ...entry };
  }

  getActiveCooldown(key: string, now = Date.now()): ActiveCooldown | undefined {
    const entry = this.get(key, now);
    if (!entry?.cooldownUntil) {
      return undefined;
    }

    const remainingMs = Math.max(0, entry.cooldownUntil - now);
    if (remainingMs <= 0) {
      return undefined;
    }

    return {
      failureCount: entry.failureCount,
      lastFailureAt: entry.lastFailureAt,
      cooldownUntil: entry.cooldownUntil,
      remainingMs,
    };
  }

  update(
    key: string,
    updater: (current: CooldownEntry | undefined, now: number) => CooldownEntry | undefined,
  ): CooldownEntry | undefined {
    const now = Date.now();
    const current = this.get(key, now);
    const next = updater(current, now);

    if (!next) {
      if (this.entries.delete(key)) {
        this.schedulePersist();
      }
      return undefined;
    }

    this.entries.set(key, { ...next });
    if (!current || !this.isSameEntry(current, next)) {
      this.schedulePersist();
    }
    return { ...next };
  }

  private requireEntry(entry: CooldownEntry | undefined, operation: string, key: string): CooldownEntry {
    if (!entry) {
      throw new Error(`PersistentCooldownStore.${operation} produced no entry for ${key}`);
    }

    return entry;
  }

  open(key: string, cooldownMs: number, failureCount = 1): CooldownEntry {
    const normalizedCooldownMs = Math.max(1, Math.trunc(cooldownMs));
    const normalizedFailureCount = Math.max(1, Math.trunc(failureCount));

    return this.requireEntry(
      this.update(key, (_current, now) => ({
        failureCount: normalizedFailureCount,
        lastFailureAt: now,
        cooldownUntil: now + normalizedCooldownMs,
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
        };
      }),
      "recordFailure",
      key,
    );
  }

  reset(key: string): void {
    if (this.entries.delete(key)) {
      this.schedulePersist();
    }
  }

  clear(): void {
    if (this.entries.size === 0) {
      return;
    }

    this.entries.clear();
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    if (this.persistQueued) {
      await Promise.resolve();
    }
    await this.writePromise;
  }

  private isSameEntry(left: CooldownEntry, right: CooldownEntry): boolean {
    return (
      left.failureCount === right.failureCount &&
      left.lastFailureAt === right.lastFailureAt &&
      left.cooldownUntil === right.cooldownUntil
    );
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const now = Date.now();

      for (const [key, value] of Object.entries(parsed)) {
        const entry = normalizeEntry(value);
        if (!entry) {
          continue;
        }

        if (entry.cooldownUntil !== null && entry.cooldownUntil <= now) {
          continue;
        }

        this.entries.set(key, entry);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load cooldown store ${this.filePath}: ${message}`);
    }
  }

  private schedulePersist(): void {
    if (this.persistQueued) {
      return;
    }

    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      this.writePromise = this.writePromise
        .then(async () => {
          await this.persist();
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to persist cooldown store ${this.filePath}: ${message}`);
        });
    });
  }

  private async persist(): Promise<void> {
    const payload = Object.fromEntries(
      Array.from(this.entries.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value]),
    );

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
