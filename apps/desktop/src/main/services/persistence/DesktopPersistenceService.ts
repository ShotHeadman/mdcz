import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import {
  createPersistenceDatabase,
  isSchemaMigrationFailure,
  LibraryRepository,
  MediaRootRepository,
  moveDatabaseAside,
  type PersistenceDatabase,
  runMigrations,
  ScanTaskRepository,
  ScrapeRunRepository,
} from "@mdcz/persistence";
import { recoverInterruptedPublications } from "@mdcz/runtime";
import { app, dialog } from "electron";
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

const confirmDatabaseRebuild = async (databasePath: string, error: Error): Promise<boolean> => {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "MDCz",
    message: "数据库无法升级到当前版本",
    detail: [
      `数据库文件：${databasePath}`,
      "重建会先把旧数据库重命名备份到同一目录，再创建新的数据库。媒体库索引、扫描与刮削历史会被清空，可通过重新扫描恢复；设置和媒体目录不受影响。",
      `错误信息：${error.message}`,
    ].join("\n\n"),
    buttons: ["备份并重建", "退出"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
};

export interface DesktopPersistenceRepositories {
  library: LibraryRepository;
  mediaRoots: MediaRootRepository;
  scrapeRuns: ScrapeRunRepository;
  scanTasks: ScanTaskRepository;
}

export interface DesktopPersistenceState {
  database: PersistenceDatabase;
  repositories: DesktopPersistenceRepositories;
}

export class DesktopPersistenceService {
  private state: DesktopPersistenceState | null = null;
  private initializePromise: Promise<DesktopPersistenceState> | null = null;

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
    if (!this.initializePromise) {
      this.initializePromise = this.open().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return await this.initializePromise;
  }

  async getState(): Promise<DesktopPersistenceState> {
    return await this.initialize();
  }

  async close(): Promise<void> {
    this.state?.database.close();
    this.state = null;
    this.initializePromise = null;
  }

  private async open(allowRebuild = true): Promise<DesktopPersistenceState> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = createPersistenceDatabase({
      path: this.databasePath,
      ...(this.nativeBinding === null ? {} : { nativeBinding: this.nativeBinding ?? resolveNativeBinding() }),
    });

    try {
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
      database.close();
      if (
        !allowRebuild ||
        !isSchemaMigrationFailure(error) ||
        !(await confirmDatabaseRebuild(this.databasePath, error))
      ) {
        throw error;
      }
      const backupPath = moveDatabaseAside(this.databasePath);
      loggerService.getLogger("Persistence").warn(`Rebuilt database; previous database moved to ${backupPath}`);
      return await this.open(false);
    }
  }
}
