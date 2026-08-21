import { join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { FileTranslationMappingStore } from "@mdcz/runtime/translate";
import { app } from "electron";
import { getDesktopUserDataPath } from "../../appIdentity";

const resolveBundledDirectory = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "mapping_table")
    : join(app.getAppPath(), "../../packages/runtime/resources/mapping_table");

const resolveWritableDirectory = (): string => {
  try {
    return join(getDesktopUserDataPath(), "mapping_table");
  } catch {
    return join(process.cwd(), "tmp", "mapping_table");
  }
};

export const translationMappingStore = new FileTranslationMappingStore({
  bundledDirectory: resolveBundledDirectory(),
  writableDirectory: resolveWritableDirectory(),
  logger: loggerService.getLogger("TranslationMappingStore"),
});
