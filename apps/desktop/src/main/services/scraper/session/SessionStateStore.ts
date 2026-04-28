import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toErrorMessage } from "@main/utils/common";
import { app } from "electron";
import PQueue from "p-queue";
import { parsePersistedSessionState } from "./SessionRecovery";
import type { PersistedSessionState, ScrapeSessionOptions } from "./types";

interface SessionStateStoreLogger {
  warn(message: string): void;
}

const DEFAULT_PERSIST_INTERVAL_MS = 2000;

const getDefaultStatePath = (): string => {
  try {
    return join(app.getPath("userData"), "session-state.json");
  } catch {
    return join(process.cwd(), ".tmp", "session-state.json");
  }
};

export class SessionStateStore {
  private readonly statePath: string;

  private readonly persistIntervalMs: number;

  private readonly writeQueue = new PQueue({ concurrency: 1 });

  private dirty = false;

  private active = false;

  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly logger: SessionStateStoreLogger,
    private readonly snapshotProvider: () => PersistedSessionState | null,
    options: ScrapeSessionOptions = {},
  ) {
    this.statePath = options.statePath ?? getDefaultStatePath();
    this.persistIntervalMs = Math.max(0, Math.trunc(options.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS));
  }

  start(): void {
    this.stop();
    this.active = true;
    this.markDirty();

    if (this.persistIntervalMs > 0) {
      this.persistTimer = setInterval(() => {
        void this.flushDirty();
      }, this.persistIntervalMs);
    }

    void this.flushNow();
  }

  stop(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    this.active = false;
    this.dirty = false;
  }

  markDirty(): void {
    if (!this.active) {
      return;
    }

    this.dirty = true;
  }

  async flushDirty(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    await this.flushNow();
  }

  async flushNow(): Promise<void> {
    if (!this.active) {
      return;
    }

    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      return;
    }

    this.dirty = false;
    if (!this.active) {
      return;
    }

    await this.writeSnapshot(snapshot);
  }

  async clear(): Promise<void> {
    this.stop();
    await this.writeQueue.add(async () => {
      await rm(this.statePath, { force: true }).catch(() => undefined);
    });
  }

  async read(): Promise<PersistedSessionState | null> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return parsePersistedSessionState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async writeSnapshot(snapshot: PersistedSessionState): Promise<void> {
    const content = JSON.stringify(snapshot, null, 2);

    await this.writeQueue.add(async () => {
      try {
        await mkdir(dirname(this.statePath), { recursive: true });
        await writeFile(this.statePath, content, "utf8");
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to persist scrape session state: ${message}`);
      }
    });
  }
}
