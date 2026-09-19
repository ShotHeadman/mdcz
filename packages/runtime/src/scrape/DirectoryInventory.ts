import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { filesystemPathKey, inspectFileEntry, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import { type ParsedNfoSnapshot, parseNfoSnapshot } from "../maintenance/nfoSnapshot";

export class DirectoryInventory {
  readonly submittedRefs = new Map<string, RootFileRef[]>();
  readonly generatedStrms = new Set<string>();
  readonly registeredNfos = new Map<string, readonly string[]>();
  private readonly directoryPaths = new Map<string, Promise<string>>();
  private readonly directories = new Map<string, Promise<readonly Dirent[]>>();
  private readonly fileStats = new Map<string, Promise<Stats>>();
  private readonly nfos = new Map<string, Promise<ParsedNfoSnapshot | undefined>>();
  private readonly nfoContents = new Map<string, Promise<string | undefined>>();

  observeDirectory(path: string, canonicalPath: string, entries: readonly Dirent[]): void {
    this.directoryPaths.set(filesystemPathKey(path), Promise.resolve(canonicalPath));
    const key = filesystemPathKey(canonicalPath);
    if (!this.directories.has(key)) this.directories.set(key, Promise.resolve(entries));
  }

  private canonicalDirectory(path: string): Promise<string> {
    const key = filesystemPathKey(path);
    let pending = this.directoryPaths.get(key);
    if (!pending) {
      pending = fs.realpath(path).catch(async (error: NodeJS.ErrnoException) => {
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

  observeFile(canonicalEntryPath: string, facts: Stats): void {
    this.fileStats.set(filesystemPathKey(canonicalEntryPath), Promise.resolve(facts));
  }

  async stats(path: string): Promise<Stats> {
    const entryPath = await this.entryPath(path);
    const key = filesystemPathKey(entryPath);
    let pending = this.fileStats.get(key);
    if (!pending) {
      pending = fs.stat(entryPath);
      this.fileStats.set(key, pending);
    }
    return await pending;
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
        const entry = await inspectFileEntry(filePath);
        this.observeFile(entry.entryPath, entry.stats);
        identity = entry.entryIdentity;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        identity = filesystemPathKey(await this.entryPath(filePath));
      }
      const submitted = this.submittedRefs.get(identity) ?? [];
      if (!submitted.some((item) => item.rootId === ref.rootId && item.relativePath === ref.relativePath))
        submitted.push(ref);
      this.submittedRefs.set(identity, submitted);
      if (!admitted.has(identity)) admitted.set(identity, ref);
    }
    return [...admitted.values()];
  }

  async mediaEntries(directory: string): Promise<readonly Dirent[]> {
    const entries = await this.entries(directory);
    const canonical = await this.canonicalDirectory(directory);
    return entries.filter((entry) => {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !isPrimaryVideoFileName(entry.name)) return false;
      const name = parse(entry.name);
      if (name.ext.toLowerCase() !== ".strm") return true;
      return (
        !this.generatedStrms.has(filesystemPathKey(join(canonical, entry.name))) &&
        !entries.some(
          (sibling) =>
            (sibling.isFile() || sibling.isSymbolicLink()) &&
            isPrimaryVideoFileName(sibling.name) &&
            parse(sibling.name).ext.toLowerCase() !== ".strm" &&
            parse(sibling.name).name.toLowerCase() === name.name.toLowerCase(),
        )
      );
    });
  }
}
