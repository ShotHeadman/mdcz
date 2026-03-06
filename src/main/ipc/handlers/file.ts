import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { nfoGenerator } from "@main/services/scraper/NfoGenerator";
import { toErrorMessage } from "@main/utils/common";
import { parseNfo } from "@main/utils/nfo";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { CrawlerData } from "@shared/types";
import { dialog } from "electron";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

export const createFileHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.File_ListEntries
  | typeof IpcChannel.File_Browse
  | typeof IpcChannel.File_Delete
  | typeof IpcChannel.File_NfoRead
  | typeof IpcChannel.File_NfoWrite
> => {
  const { windowService } = context;

  return {
    [IpcChannel.File_ListEntries]: t.procedure.input<{ dirPath?: string }>().action(
      async ({
        input,
      }): Promise<{
        entries: Array<{
          type: "file" | "directory";
          path: string;
          name: string;
          size?: number;
          lastModified?: string | null;
        }>;
      }> => {
        try {
          const dirPath = input?.dirPath?.trim();
          if (!dirPath) {
            throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, "Directory path is required");
          }

          try {
            const stats = await stat(dirPath);
            if (!stats.isDirectory()) {
              throw new Error("Not a directory");
            }
          } catch {
            throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, `Directory not found: ${dirPath}`);
          }

          const entries = await readdir(dirPath, { withFileTypes: true });
          const normalizedEntries: Array<{
            type: "file" | "directory";
            path: string;
            name: string;
            size?: number;
            lastModified?: string | null;
          }> = [];

          for (const entry of entries) {
            const entryPath = join(dirPath, entry.name);
            try {
              const stats = await lstat(entryPath);
              if (stats.isSymbolicLink()) {
                // Avoid traversing symlink/junction targets from renderer recursive scans.
                continue;
              }

              const type = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null;
              if (!type) {
                continue;
              }

              normalizedEntries.push({
                type,
                path: entryPath,
                name: entry.name,
                size: type === "file" ? stats.size : undefined,
                lastModified: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
              });
            } catch {
              // Skip inaccessible entries and keep scanning.
            }
          }

          normalizedEntries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
          return { entries: normalizedEntries };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      },
    ),
    [IpcChannel.File_Browse]: t.procedure
      .input<{ type?: "file" | "directory"; filters?: Array<{ name: string; extensions: string[] }> }>()
      .action(async ({ input }) => {
        const mainWindow = windowService.getMainWindow();
        const type = input?.type;
        const properties = type === "directory" ? (["openDirectory"] as const) : (["openFile"] as const);
        const options = {
          properties: [...properties, "multiSelections"] as Array<
            "openFile" | "openDirectory" | "multiSelections" | "showHiddenFiles" | "createDirectory" | "promptToCreate"
          >,
          filters: input?.filters,
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return { paths: result.canceled ? null : result.filePaths };
      }),
    [IpcChannel.File_Delete]: t.procedure
      .input<{ filePaths?: string[] }>()
      .action(async ({ input }): Promise<{ deletedCount: number; failedCount: number }> => {
        const filePaths = input?.filePaths ?? [];
        let deletedCount = 0;
        let failedCount = 0;

        for (const filePath of filePaths) {
          if (!filePath.trim()) {
            continue;
          }
          try {
            await rm(filePath, { force: true });
            deletedCount += 1;
          } catch (error) {
            failedCount += 1;
            logger.warn(`Failed to delete file '${filePath}': ${toErrorMessage(error)}`);
          }
        }

        return { deletedCount, failedCount };
      }),
    [IpcChannel.File_NfoRead]: t.procedure.input<{ nfoPath?: string }>().action(async ({ input }) => {
      try {
        const nfoPath = input?.nfoPath?.trim();
        if (!nfoPath) {
          throw createIpcError(IpcErrorCode.PARSE_ERROR, "NFO path is required");
        }
        const content = await readFile(nfoPath, "utf8");
        return { data: parseNfo(content) };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.File_NfoWrite]: t.procedure
      .input<{ nfoPath?: string; data?: CrawlerData }>()
      .action(async ({ input }): Promise<{ success: true }> => {
        try {
          const nfoPath = input?.nfoPath?.trim();
          const data = input?.data;
          if (!nfoPath || !data) {
            throw createIpcError(IpcErrorCode.FILE_WRITE_ERROR, "NFO path and data are required");
          }
          await nfoGenerator.writeNfo(nfoPath, data);
          return { success: true as const };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
  };
};
