import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createPersistenceDatabase,
  LibraryRepository,
  MaintenanceRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  runMigrations,
  TaskRepository,
} from "@mdcz/persistence";
import { app } from "electron";

export interface DesktopPersistenceRepositories {
  library: LibraryRepository;
  maintenance: MaintenanceRepository;
  mediaRoots: MediaRootRepository;
  tasks: TaskRepository;
}

export interface DesktopPersistenceState {
  database: PersistenceDatabase;
  repositories: DesktopPersistenceRepositories;
}

export class DesktopPersistenceService {
  private state: DesktopPersistenceState | null = null;

  constructor(private readonly databasePath = join(app.getPath("userData"), "mdcz.sqlite")) {}

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
    const database = createPersistenceDatabase({ path: this.databasePath });

    try {
      runMigrations(database);
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
          maintenance: new MaintenanceRepository(database),
          mediaRoots: new MediaRootRepository(database),
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
