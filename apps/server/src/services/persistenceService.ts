import {
  createPersistenceDatabase,
  LibraryRepairIssueRepository,
  LibraryRepository,
  MaintenanceDirectoryRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  PublicationJournalRepository,
  runMigrations,
  ScanTaskRepository,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { parsePublicationJournalManifest, recoverPublications } from "@mdcz/runtime";
import type { PublicationJournalPort } from "@mdcz/runtime/publication/types";
import type Database from "better-sqlite3";
import { acquireDatabaseLease } from "../databaseFiles";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  maintenanceDirectoryTasks: MaintenanceDirectoryRepository;
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
  private initializePromise: Promise<ServerPersistenceState> | null = null;
  private closed = false;
  private lease: Database.Database | null = null;

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

    if (!this.initializePromise) {
      this.initializePromise = this.open().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return await this.initializePromise;
  }

  private async open(): Promise<ServerPersistenceState> {
    this.lease = acquireDatabaseLease(this.paths.databasePath);
    let database: PersistenceDatabase | undefined;
    try {
      database = createPersistenceDatabase({ path: this.paths.databasePath });
      runMigrations(database);
      const scrapeRuns = new ScrapeRunRepository(database);
      scrapeRuns.interruptUnfinished();
      const maintenanceDirectoryTasks = new MaintenanceDirectoryRepository(database);
      maintenanceDirectoryTasks.interruptUnfinished();
      const libraryRepairIssues = new LibraryRepairIssueRepository(database);
      const mediaRoots = new MediaRootRepository(database);
      const publicationJournal = new PublicationJournalRepository(database, parsePublicationJournalManifest);
      await recoverPublications({
        journal: publicationJournal,
        repairIssues: libraryRepairIssues,
        resolveRoot: async (rootId) => await mediaRoots.get(rootId),
      });
      this.state = {
        database,
        repositories: {
          maintenanceDirectoryTasks,
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
      database?.close();
      this.lease.close();
      this.lease = null;
      throw error;
    }
  }

  async getState(): Promise<ServerPersistenceState> {
    return await this.initialize();
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.initializePromise;
    } finally {
      try {
        this.state?.database.close();
      } finally {
        this.lease?.close();
        this.lease = null;
        this.state = null;
        this.initializePromise = null;
      }
    }
  }
}
