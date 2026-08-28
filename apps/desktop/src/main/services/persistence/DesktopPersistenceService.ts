import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { app } from "electron";
import { getDesktopUserDataPath } from "../../appIdentity";

/**
 * Resolves the path to the Electron-ABI better_sqlite3.node binding.
 * - In dev: apps/desktop/native/better_sqlite3.node (populated by postinstall)
 * - In packaged build: <resources>/native/better_sqlite3.node (extraResources)
 * The hoisted node_modules copy stays at the Node ABI for server/test usage.
 */
const resolveNativeBinding = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "native", "better_sqlite3.node")
    : join(app.getAppPath(), "native", "better_sqlite3.node");

export interface DesktopPersistenceRepositories {
  library: LibraryRepository;
  libraryRepairIssues: LibraryRepairIssueRepository;
  mediaRoots: MediaRootRepository;
  publicationJournal: PublicationJournalRepository;
  scrapeRuns: ScrapeRunRepository;
  tasks: TaskRepository;
}

export interface DesktopPersistenceState {
  database: PersistenceDatabase;
  repositories: DesktopPersistenceRepositories;
}

export class DesktopPersistenceService {
  private state: DesktopPersistenceState | null = null;

  constructor(
    private readonly databasePath = join(getDesktopUserDataPath(), "mdcz.sqlite"),
    private readonly nativeBinding?: string | null,
  ) {}

  get initialized(): boolean {
    return this.state !== null;
  }

  get path(): string {
    return this.databasePath;
  }

  async initialize(): Promise<DesktopPersistenceState> {
    if (this.state) {
      return this.state;
    }

    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = createPersistenceDatabase({
      path: this.databasePath,
      ...(this.nativeBinding === null ? {} : { nativeBinding: this.nativeBinding ?? resolveNativeBinding() }),
    });

    try {
      runMigrations(database);
      const scrapeRuns = new ScrapeRunRepository(database);
      scrapeRuns.interruptUnfinished();
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
          libraryRepairIssues: new LibraryRepairIssueRepository(database),
          mediaRoots: new MediaRootRepository(database),
          publicationJournal: new PublicationJournalRepository(database),
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

  async getState(): Promise<DesktopPersistenceState> {
    return await this.initialize();
  }

  async close(): Promise<void> {
    this.state?.database.close();
    this.state = null;
  }
}
