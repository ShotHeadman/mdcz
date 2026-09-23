import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import { type ParsedNfoSnapshot, parseNfoSnapshot } from "../maintenance/nfoSnapshot";

export class DirectoryInventory {
  readonly registeredNfos = new Map<string, readonly string[]>();
  private readonly directoryPaths = new Map<string, Promise<string>>();
  private readonly directories = new Map<string, Promise<readonly Dirent[]>>();
  private readonly fileObservations = new Map<string, Promise<{ entryPath: string; stats: Stats }>>();
  private readonly nfos = new Map<string, Promise<ParsedNfoSnapshot | undefined>>();
  private readonly nfoContents = new Map<string, Promise<string | undefined>>();

  observeDirectory(path: string, canonicalPath: string, entries: readonly Dirent[]): void {
    this.directoryPaths.set(filesystemPathKey(path), Promise.resolve(canonicalPath));
    const key = filesystemPathKey(canonicalPath);
    this.directoryPaths.set(key, Promise.resolve(canonicalPath));
    if (!this.directories.has(key)) this.directories.set(key, Promise.resolve(entries));
  }

  canonicalDirectory(path: string): Promise<string> {
    const key = filesystemPathKey(path);
    let pending = this.directoryPaths.get(key);
    if (!pending) {
      pending = fs
        .realpath(path)
        .then((canonical) => {
          this.directoryPaths.set(filesystemPathKey(canonical), Promise.resolve(canonical));
          return canonical;
        })
        .catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" || dirname(path) === path) throw error;
          return join(await this.canonicalDirectory(dirname(path)), basename(path));
        });
      this.directoryPaths.set(key, pending);
    }
    return pending;
  }

  async entries(path: string): Promise<readonly Dirent[]> {
    try {
      const canonical = await this.canonicalDirectory(path);
      const key = filesystemPathKey(canonical);
      let pending = this.directories.get(key);
      if (!pending) {
        pending = fs.readdir(canonical, { withFileTypes: true });
        this.directories.set(key, pending);
      }
      return await pending;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  observeFile(path: string, facts: Stats, canonicalEntryPath: string): void {
    const observation = Promise.resolve({ entryPath: canonicalEntryPath, stats: facts });
    for (const key of new Set([filesystemPathKey(path), filesystemPathKey(canonicalEntryPath)])) {
      if (!this.fileObservations.has(key)) this.fileObservations.set(key, observation);
    }
  }

  observeFileError(path: string, error: unknown): void {
    const observation = Promise.reject<{ entryPath: string; stats: Stats }>(error);
    void observation.catch(() => undefined);
    this.fileObservations.set(filesystemPathKey(path), observation);
  }

  private observeFileEntry(path: string): Promise<{ entryPath: string; stats: Stats }> {
    const requested = filesystemPathKey(path);
    const existing = this.fileObservations.get(requested);
    if (existing) return existing;
    let pending!: Promise<{ entryPath: string; stats: Stats }>;
    pending = (async () => {
      const entryPath = await this.entryPath(path);
      const identity = filesystemPathKey(entryPath);
      if (identity !== requested) {
        const cached = this.fileObservations.get(identity);
        if (cached && cached !== pending) return await cached;
        this.fileObservations.set(identity, pending);
      }
      return { entryPath, stats: await fs.stat(entryPath) };
    })();
    this.fileObservations.set(requested, pending);
    return pending;
  }

  async stats(path: string): Promise<Stats> {
    return (await this.observeFileEntry(path)).stats;
  }

  async entryPath(path: string): Promise<string> {
    return join(await this.canonicalDirectory(dirname(path)), basename(path));
  }

  async assertUnchanged(paths: readonly string[]): Promise<void> {
    for (const path of new Set(paths)) {
      const observed = await this.stats(path);
      const current = await fs.stat(path);
      if (
        observed.dev !== current.dev ||
        observed.ino !== current.ino ||
        observed.size !== current.size ||
        observed.mtimeMs !== current.mtimeMs
      ) {
        throw new Error(`Local metadata changed; preview again: ${path}`);
      }
    }
  }

  async loadNfo(path: string): Promise<ParsedNfoSnapshot | undefined> {
    const entryPath = await this.entryPath(path);
    const key = filesystemPathKey(entryPath);
    let pending = this.nfos.get(key);
    if (!pending) {
      pending = this.readNfo(entryPath).then((content) =>
        content === undefined ? undefined : parseNfoSnapshot(content),
      );
      this.nfos.set(key, pending);
    }
    return await pending;
  }

  async readNfo(path: string): Promise<string | undefined> {
    const entryPath = await this.entryPath(path);
    const key = filesystemPathKey(entryPath);
    let pending = this.nfoContents.get(key);
    if (!pending) {
      pending = fs.readFile(entryPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      this.nfoContents.set(key, pending);
    }
    return await pending;
  }

  async admitRefs(
    refs: readonly RootFileRef[],
    resolveRoot: (id: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>,
  ): Promise<RootFileRef[]> {
    const admitted = new Map<string, RootFileRef>();
    for (const ref of refs) {
      const filePath = resolveRootRelativePath(await resolveRoot(ref.rootId), ref.relativePath);
      let identity: string;
      try {
        const observed = await this.observeFileEntry(filePath);
        if (!observed.stats.isFile()) throw new Error(`Media entry is not a file: ${filePath}`);
        identity = filesystemPathKey(observed.entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        identity = filesystemPathKey(await this.entryPath(filePath));
      }
      if (!admitted.has(identity)) admitted.set(identity, ref);
    }
    return [...admitted.values()];
  }

  async mediaEntries(directory: string): Promise<readonly Dirent[]> {
    const entries = await this.entries(directory);
    const candidates = entries.filter((entry) => {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !isPrimaryVideoFileName(entry.name)) return false;
      const name = parse(entry.name);
      if (name.ext.toLowerCase() !== ".strm") return true;
      return !entries.some(
        (sibling) =>
          (sibling.isFile() || sibling.isSymbolicLink()) &&
          isPrimaryVideoFileName(sibling.name) &&
          parse(sibling.name).ext.toLowerCase() !== ".strm" &&
          filesystemPathKey(join(directory, parse(sibling.name).name)) ===
            filesystemPathKey(join(directory, name.name)),
      );
    });
    return candidates;
  }
}
