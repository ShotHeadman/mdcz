import { type FSWatcher, watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface RuntimeProfileWatcherOptions {
  directory: string;
  debounceMs?: number;
  shouldReload: (fileName: string | null) => boolean;
  reload: (fileName: string | null) => Promise<void>;
  onDiagnostic?: (kind: "watch-error" | "read-error", error: unknown) => void;
}

/** Directory watcher used by both app adapters; reloads are serialized and coalesced. */
export class RuntimeProfileWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reloadChain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: RuntimeProfileWatcherOptions) {}

  async start(): Promise<void> {
    if (this.watcher) return;
    this.stopped = false;
    await mkdir(this.options.directory, { recursive: true });
    try {
      this.watcher = watch(this.options.directory, { persistent: false }, (_eventType, fileName) => {
        const name = fileName == null ? null : String(fileName);
        if (!this.options.shouldReload(name)) return;
        this.scheduleReload(name);
      });
      this.watcher.on("error", (error) => this.options.onDiagnostic?.("watch-error", error));
    } catch (error) {
      this.options.onDiagnostic?.("watch-error", error);
      throw error;
    }
  }

  async rebind(directory: string): Promise<void> {
    if (this.options.directory === directory && this.watcher) return;
    await this.stop();
    this.options.directory = directory;
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.watcher?.close();
    this.watcher = null;
    await this.reloadChain;
  }

  private scheduleReload(fileName: string | null): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.reloadChain = this.reloadChain
        .then(async () => {
          if (!this.stopped) await this.options.reload(fileName);
        })
        .catch((error) => this.options.onDiagnostic?.("read-error", error));
    }, this.options.debounceMs ?? 250);
    this.timer.unref?.();
  }
}

export const profileFileName = (filePath: string): string => path.basename(filePath);
