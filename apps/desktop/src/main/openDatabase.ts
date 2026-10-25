import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { rebuildDatabase } from "@mdcz/server/databaseFiles";
import { DatabaseUpgradeRequiredError, type ServerPersistenceService } from "@mdcz/server/services/persistenceService";
import { app, dialog } from "electron";

const REBUILD_DIALOG_TEXT = {
  zh: {
    message: "数据库无法升级到当前版本",
    file: "数据库文件：",
    explanation:
      "重建会先把旧数据库重命名备份到同一目录，再创建新的数据库。媒体库索引、扫描与刮削历史会被清空，可通过重新扫描恢复；库需要重新创建；设置和媒体文件不受影响。",
    error: "错误信息：",
    buttons: ["备份并重建", "退出"],
  },
  en: {
    message: "The database cannot be upgraded to the current version",
    file: "Database file: ",
    explanation:
      "Rebuilding first renames the old database to a backup in the same folder, then creates a new one. The library index and scan/scrape history will be cleared and can be restored by scanning again; libraries must be created again; settings and media files are not affected.",
    error: "Error: ",
    buttons: ["Back up and rebuild", "Quit"],
  },
};

/** Opens the database, offering to rebuild one this version cannot migrate. False when the user chose to quit. */
export const openDatabase = async (persistence: ServerPersistenceService, nativeBinding: string): Promise<boolean> => {
  try {
    await persistence.initialize();
    return true;
  } catch (error) {
    if (!(error instanceof DatabaseUpgradeRequiredError)) throw error;
    // Runs before any window exists, so the page's saved language is unavailable; follow the same system-locale rule.
    const text = REBUILD_DIALOG_TEXT[app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en"];
    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "MDCz",
      message: text.message,
      detail: [`${text.file}${error.databasePath}`, text.explanation, `${text.error}${cause}`].join("\n\n"),
      buttons: text.buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return false;
    const backupPath = rebuildDatabase(error.databasePath, nativeBinding);
    runtimeLoggerService.getLogger("Persistence").warn(`Rebuilt the database; the previous one is ${backupPath}`);
    await persistence.initialize();
    return true;
  }
};
