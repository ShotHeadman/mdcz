import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createPersistenceDatabase,
  LibraryRepository,
  MediaRootRepository,
  type PersistenceDatabase,
  runMigrations,
  TaskRepository,
} from "@mdcz/persistence";

import type { ServerRuntimePaths } from "./configService";

export interface ServerPersistenceRepositories {
  library: LibraryRepository;
  mediaRoots: MediaRootRepository;
  tasks: TaskRepository;
}

export interface ServerPersistenceState {
  database: PersistenceDatabase;
  repositories: ServerPersistenceRepositories;
}

export class ServerPersistenceService {
  private state: ServerPersistenceState | null = null;

  constructor(private readonly paths: Pick<ServerRuntimePaths, "databasePath">) {}

  get initialized(): boolean {
    return this.state !== null;
  }

  get databasePath(): string {
    return this.paths.databasePath;
  }

  async initialize(): Promise<ServerPersistenceState> {
    if (this.state) {
      return this.state;
    }

    await mkdir(dirname(this.paths.databasePath), { recursive: true });
    const database = createPersistenceDatabase({ path: this.paths.databasePath });

    try {
      runMigrations(database);
      this.state = {
        database,
        repositories: {
          library: new LibraryRepository(database),
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

  async getState(): Promise<ServerPersistenceState> {
    return await this.initialize();
  }

  async close(): Promise<void> {
    this.state?.database.close();
    this.state = null;
  }
}
