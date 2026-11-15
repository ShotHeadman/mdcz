import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { toErrorMessage } from "../shared";
import type { PublicationFileSystem } from "./types";

export type PublicationJournalEntry = { path: string; restoreTo: string | null };

export interface PublicationJournalStore {
  record(entry: PublicationJournalEntry): void;
  forget(path: string): void;
  list(): PublicationJournalEntry[];
}

let store: PublicationJournalStore | undefined;

/**
 * Process-wide like the runtime logger, so every publication records into the app's database whoever starts it.
 * Paths are recorded before they are created and forgotten once they are gone; a crash leaves exactly the records
 * startup recovery needs, without walking any library.
 */
export const publicationJournal = {
  attach(next: PublicationJournalStore): void {
    store = next;
  },
  record(temporaryPath: string, restoreTo?: string): void {
    store?.record({ path: path.resolve(temporaryPath), restoreTo: restoreTo ? path.resolve(restoreTo) : null });
  },
  forget(temporaryPath: string): void {
    store?.forget(path.resolve(temporaryPath));
  },
};

/** A journaled folder inside `parent` for the assets a scrape prepares before publishing them. */
export const createStagingDirectory = async (parent: string): Promise<string> => {
  const directory = path.join(parent, `.mdcz-staging-${randomUUID()}`);
  publicationJournal.record(directory);
  await mkdir(directory, { recursive: true });
  return directory;
};

export const removeStagingDirectory = async (directory: string): Promise<void> => {
  await rm(directory, { recursive: true, force: true });
  publicationJournal.forget(directory);
};

/** One publication's temporary files, journaled while they exist. */
export class TemporaryPaths {
  readonly #paths = new Set<string>();

  add(temporaryPath: string): void {
    publicationJournal.record(temporaryPath);
    this.#paths.add(temporaryPath);
  }

  /** The file is in place under its final name, so there is nothing left to remove. */
  settle(temporaryPath: string): void {
    this.#paths.delete(temporaryPath);
    publicationJournal.forget(temporaryPath);
  }

  async removeAll(fileSystem: PublicationFileSystem, warn: (message: string) => void): Promise<void> {
    for (const temporaryPath of this.#paths) {
      try {
        await fileSystem.rm(temporaryPath, { force: true });
        publicationJournal.forget(temporaryPath);
      } catch (error) {
        // The record stays, so the next start removes it.
        warn(`Failed to remove publication temporary file ${temporaryPath}: ${toErrorMessage(error)}`);
      }
    }
    this.#paths.clear();
  }
}
