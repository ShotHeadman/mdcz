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
  ScrapeRunRepository,
  TaskRepository,
} from "@mdcz/persistence";
import { recoverPublications } from "@mdcz/runtime/publication";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  library: LibraryRepository;
  libraryRepairIssues: LibraryRepairIssueRepository;
  mediaRoots: MediaRootRepository;
  publicationJournal: PublicationJournalRepository;
  scrapeRuns: ScrapeRunRepository;
  tasks: TaskRepository;
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
      const publicationJournal = new PublicationJournalRepository(database);
      await recoverPublications({
        journal: publicationJournal,
        repairIssues: libraryRepairIssues,
        resolveRoot: async (rootId) => await mediaRoots.get(rootId, { includeDeleted: true }),
      });
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
          libraryRepairIssues,
          mediaRoots,
          publicationJournal,
          scrapeRuns,
          tasks: new TaskRepository(database),
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
