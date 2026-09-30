import {
  createPersistenceDatabase,
  isSchemaMigrationFailure,
  LibraryRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  runMigrations,
  ScanTaskRepository,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { recoverInterruptedPublications } from "@mdcz/runtime";
import type Database from "better-sqlite3";
import { acquireDatabaseLease } from "../databaseFiles";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  library: LibraryRepository;
  mediaRoots: MediaRootRepository;
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
      const mediaRoots = new MediaRootRepository(database);
      await recoverInterruptedPublications(await mediaRoots.list());
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
          mediaRoots,
          scrapeRuns,
          scanTasks: new ScanTaskRepository(database),
        },
      };
      return this.state;
    } catch (error) {
      database?.close();
      this.lease.close();
      this.lease = null;
      if (isSchemaMigrationFailure(error)) {
        throw new Error(
          `Database ${this.paths.databasePath} cannot be upgraded to this MDCz version. Stop MDCz, then run from the MDCz install directory: node server.js database rebuild "${this.paths.databasePath}" --confirm (Docker: docker compose run --rm --no-deps mdcz node server.js database rebuild "${this.paths.databasePath}" --confirm). The database is renamed to a backup next to itself and a new one is created on the next start; configuration and profiles are kept.`,
          { cause: error },
        );
      }
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
