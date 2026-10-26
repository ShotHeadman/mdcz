import {
  CredentialRepository,
  createPersistenceDatabase,
  DownloaderRepository,
  isSchemaMigrationFailure,
  LibraryRepository,
  MediaLibraryRepository,
  MediaRootRepository,
  PendingRepository,
  type PersistenceDatabase,
  PublicationJournalRepository,
  runMigrations,
  ScanTaskRepository,
  ScrapeRunRepository,
  SiteResultRepository,
} from "@mdcz/persistence";
import { recoverInterruptedPublications } from "@mdcz/runtime";
import type Database from "better-sqlite3";
import { acquireDatabaseLease } from "../databaseFiles";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  credentials: CredentialRepository;
  downloaders: DownloaderRepository;
  library: LibraryRepository;
  mediaLibraries: MediaLibraryRepository;
  mediaRoots: MediaRootRepository;
  pending: PendingRepository;
  scrapeRuns: ScrapeRunRepository;
  scanTasks: ScanTaskRepository;
  siteResults: SiteResultRepository;
}

/** A schema migration failed; this version opens the database only after `rebuildDatabase` moves it aside. */
export class DatabaseUpgradeRequiredError extends Error {
  override readonly name = "DatabaseUpgradeRequiredError";

  constructor(
    readonly databasePath: string,
    options: ErrorOptions,
  ) {
    super(
      `Database ${databasePath} cannot be upgraded to this MDCz version. Stop MDCz, then run from the MDCz install directory: node server.js database rebuild "${databasePath}" --confirm (Docker: docker compose run --rm --no-deps mdcz node server.js database rebuild "${databasePath}" --confirm). The database is renamed to a backup next to itself and a new one is created on the next start; configuration and profiles are kept, libraries and API keys must be created again.`,
      options,
    );
  }
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

  constructor(
    private readonly paths: Pick<ServerRuntimePaths, "databasePath">,
    private readonly options: { nativeBinding?: string } = {},
  ) {}

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
    this.lease = acquireDatabaseLease(this.paths.databasePath, this.options.nativeBinding);
    let database: PersistenceDatabase | undefined;
    try {
      database = createPersistenceDatabase({
        path: this.paths.databasePath,
        nativeBinding: this.options.nativeBinding,
      });
      runMigrations(database);
      const scrapeRuns = new ScrapeRunRepository(database);
      scrapeRuns.interruptUnfinished();
      const mediaRoots = new MediaRootRepository(database);
      await recoverInterruptedPublications(new PublicationJournalRepository(database));
      this.state = {
        database,
        repositories: {
          credentials: new CredentialRepository(database),
          downloaders: new DownloaderRepository(database),
          library: new LibraryRepository(database),
          mediaLibraries: new MediaLibraryRepository(database),
          mediaRoots,
          pending: new PendingRepository(database),
          scrapeRuns,
          scanTasks: new ScanTaskRepository(database),
          siteResults: new SiteResultRepository(database),
        },
      };
      return this.state;
    } catch (error) {
      database?.close();
      this.lease.close();
      this.lease = null;
      if (isSchemaMigrationFailure(error))
        throw new DatabaseUpgradeRequiredError(this.paths.databasePath, { cause: error });
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
