import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createPersistenceDatabase,
  LibraryRepairIssueRepository,
  LibraryRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  PublicationJournalRepository,
  runMigrations,
  ScanTaskRepository,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { adaptPublicationJournal, recoverPublications } from "@mdcz/runtime/publication";
import type { PublicationJournalPort } from "@mdcz/runtime/publication/types";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  library: LibraryRepository;
  libraryRepairIssues: LibraryRepairIssueRepository;
  mediaRoots: MediaRootRepository;
  publicationJournal: PublicationJournalPort;
  scrapeRuns: ScrapeRunRepository;
  scanTasks: ScanTaskRepository;
}

export interface ServerPersistenceState {
  database: PersistenceDatabase;
  repositories: ServerPersistenceRepositories;
}

export class ServerPersistenceService {
  private state: ServerPersistenceState | null = null;
  private closed = false;

  constructor(private readonly paths: Pick<ServerRuntimePaths, "databasePath">) {}

  get initialized(): boolean {
    return this.state !== null;
  }

  get databasePath(): string {
    return this.paths.databasePath;
  }

  async initialize(): Promise<ServerPersistenceState> {
    if (this.closed) {
      throw new Error("Server persistence service is closed");
    }
    if (this.state) {
      return this.state;
    }

    await mkdir(dirname(this.paths.databasePath), { recursive: true });
    const database = createPersistenceDatabase({ path: this.paths.databasePath });

    try {
      runMigrations(database);
      const scrapeRuns = new ScrapeRunRepository(database);
      scrapeRuns.interruptUnfinished();
      const libraryRepairIssues = new LibraryRepairIssueRepository(database);
      const mediaRoots = new MediaRootRepository(database);
      const publicationJournal = adaptPublicationJournal(new PublicationJournalRepository(database));
      await recoverPublications({
        journal: publicationJournal,
        repairIssues: libraryRepairIssues,
        resolveRoot: async (rootId) => await mediaRoots.get(rootId),
      });
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
          libraryRepairIssues,
          mediaRoots,
          publicationJournal,
          scrapeRuns,
          scanTasks: new ScanTaskRepository(database),
        },
      };
      return this.state;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async getState(): Promise<ServerPersistenceState> {
    return await this.initialize();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state?.database.close();
    this.state = null;
  }
}
