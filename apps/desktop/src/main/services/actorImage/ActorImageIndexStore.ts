import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import PQueue from "p-queue";

interface ActorImageLogger {
  warn(message: string): void;
}

export type ActorImageIndexEntry = {
  normalizedName: string;
  displayName: string;
  aliases: string[];
  publicFileName?: string;
  blobRelativePath?: string;
  sourceUrl?: string;
};

type ActorImageIndex = {
  version: 1;
  actors: Record<string, ActorImageIndexEntry>;
};

const createEmptyIndex = (): ActorImageIndex => ({
  version: 1,
  actors: {},
});

export class ActorImageIndexStore {
  private readonly writeQueue = new PQueue({ concurrency: 1 });

  constructor(private readonly logger: ActorImageLogger) {}

  async ensureIndexFile(indexPath: string): Promise<void> {
    await this.writeQueue.add(async () => {
      try {
        await readFile(indexPath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          await this.writeJson(indexPath, createEmptyIndex());
          return;
        }

        throw error;
      }
    });
  }

  async readIndex(indexPath: string): Promise<ActorImageIndex> {
    return await this.readJson(indexPath, createEmptyIndex());
  }

  findEntry(index: ActorImageIndex, actorNames: string[]): ActorImageIndexEntry | undefined {
    const normalizedNames = actorNames.map((name) => normalizeActorName(name)).filter((name) => name.length > 0);

    for (const normalizedName of normalizedNames) {
      const directMatch = index.actors[normalizedName];
      if (directMatch) {
        return directMatch;
      }
    }

    const normalizedNameSet = new Set(normalizedNames);
    for (const entry of Object.values(index.actors)) {
      if (normalizedNameSet.has(entry.normalizedName)) {
        return entry;
      }

      if (entry.aliases.some((alias) => normalizedNameSet.has(normalizeActorName(alias)))) {
        return entry;
      }
    }

    return undefined;
  }

  mergeEntry(
    existingEntry: ActorImageIndexEntry | undefined,
    actorNames: string[],
    nextValues: Pick<ActorImageIndexEntry, "publicFileName" | "blobRelativePath" | "sourceUrl">,
  ): ActorImageIndexEntry {
    const displayName = existingEntry?.displayName ?? actorNames[0] ?? "";
    const normalizedName = existingEntry?.normalizedName ?? normalizeActorName(displayName);
    const aliases = toUniqueActorNames([...(existingEntry?.aliases ?? []), ...actorNames]).filter(
      (alias) => normalizeActorName(alias) !== normalizedName,
    );

    return {
      normalizedName,
      displayName,
      aliases,
      publicFileName: nextValues.publicFileName ?? existingEntry?.publicFileName,
      blobRelativePath: nextValues.blobRelativePath ?? existingEntry?.blobRelativePath,
      sourceUrl: nextValues.sourceUrl ?? existingEntry?.sourceUrl,
    };
  }

  async updateEntry(
    indexPath: string,
    actorNames: string[],
    buildNextEntry: (existingEntry: ActorImageIndexEntry | undefined) => ActorImageIndexEntry | undefined,
  ): Promise<void> {
    await this.writeQueue.add(async () => {
      const index = await this.readIndex(indexPath);
      const existingEntry = this.findEntry(index, actorNames);
      const nextEntry = buildNextEntry(existingEntry);
      if (!nextEntry) {
        return;
      }

      await this.writeEntryIfChanged(indexPath, index, existingEntry, nextEntry);
    });
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeJson(filePath, fallback);
        return fallback;
      }

      throw error;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      this.logger.warn(`Corrupt JSON at ${filePath}, returning empty state (file preserved): ${message}`);
      return fallback;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async writeIndex(indexPath: string, index: ActorImageIndex): Promise<void> {
    await this.writeJson(indexPath, index);
  }

  private async writeEntryIfChanged(
    indexPath: string,
    index: ActorImageIndex,
    existingEntry: ActorImageIndexEntry | undefined,
    nextEntry: ActorImageIndexEntry,
  ): Promise<void> {
    if (existingEntry && this.isSameEntry(existingEntry, nextEntry)) {
      return;
    }

    index.actors[nextEntry.normalizedName] = nextEntry;
    if (existingEntry && existingEntry.normalizedName !== nextEntry.normalizedName) {
      delete index.actors[existingEntry.normalizedName];
    }

    await this.writeIndex(indexPath, index);
  }

  private isSameEntry(left: ActorImageIndexEntry, right: ActorImageIndexEntry): boolean {
    return (
      left.normalizedName === right.normalizedName &&
      left.displayName === right.displayName &&
      left.publicFileName === right.publicFileName &&
      left.blobRelativePath === right.blobRelativePath &&
      left.sourceUrl === right.sourceUrl &&
      left.aliases.length === right.aliases.length &&
      left.aliases.every((alias, index) => alias === right.aliases[index])
    );
  }
}
