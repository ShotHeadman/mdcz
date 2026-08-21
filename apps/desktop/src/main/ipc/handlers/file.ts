import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config/ConfigManager";
import { loggerService } from "@main/services/LoggerService";
import { nfoGenerator } from "@main/services/scraper/NfoGenerator";
import { toErrorMessage } from "@main/utils/common";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles, pathExists } from "@main/utils/file";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import {
  findExistingNfoPath,
  getNfoReadCandidates,
  getNfoWritePaths,
  nfoIgnoreFieldsToEnabledFields,
  PosterCropService,
  resolveFilenameNfoPath,
} from "@mdcz/runtime/scrape";
import { hasLiteralFilenameToken } from "@mdcz/shared/filenameTokens";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import type { CrawlerData, MediaCandidate } from "@mdcz/shared/types";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import { dialog } from "electron";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

export const createFileHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.File_ListEntries
  | typeof IpcChannel.File_ListMediaCandidates
  | typeof IpcChannel.File_Exists
  | typeof IpcChannel.File_Browse
  | typeof IpcChannel.File_Delete
  | typeof IpcChannel.File_NfoRead
  | typeof IpcChannel.File_NfoWrite
  | typeof IpcChannel.File_PosterCropSession
  | typeof IpcChannel.File_PosterCropSave
> => {
  const { windowService } = context;
  const posterCropService = new PosterCropService();
  const atomicWriteFile = async (filePath: string, content: string): Promise<void> => {
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };
  const assertDirectory = async (dirPath: string): Promise<void> => {
    try {
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) {
        throw new Error("Not a directory");
      }
    } catch {
      throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, `Directory not found: ${dirPath}`);
    }
  };

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

          await assertDirectory(dirPath);

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
    [IpcChannel.File_ListMediaCandidates]: t.procedure.input<{ dirPath?: string; excludeDirPaths?: string[] }>().action(
      async ({
        input,
      }): Promise<{
        candidates: MediaCandidate[];
        supportedExtensions: string[];
      }> => {
        try {
          const dirPath = input?.dirPath?.trim();
          const excludeDirPaths =
            input?.excludeDirPaths?.map((path) => path.trim()).filter((path): path is string => Boolean(path)) ?? [];
          if (!dirPath) {
            throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, "Directory path is required");
          }

          await assertDirectory(dirPath);
          const configuration = await configManager.getValidated();

          const discoveredPaths = await listVideoFiles(
            dirPath,
            true,
            DEFAULT_VIDEO_EXTENSIONS,
            undefined,
            excludeDirPaths,
          );
          const uniquePaths = [
            ...new Set(
              discoveredPaths.filter(
                (filePath) =>
                  isPrimaryVideoFileName(filePath) &&
                  !hasLiteralFilenameToken(basename(filePath), configuration.scrape.filenameBlacklistTokens),
              ),
            ),
          ];
          const candidates: MediaCandidate[] = [];

          for (const filePath of uniquePaths) {
            try {
              const stats = await stat(filePath);
              if (!stats.isFile()) {
                continue;
              }

              const relativePath = relative(dirPath, filePath);
              const relativeDirectory = dirname(relativePath);
              const name = filePath.split(/[\\/]+/u).at(-1) ?? filePath;

              candidates.push({
                path: filePath,
                name,
                size: stats.size,
                lastModified: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
                extension: extname(filePath).toLowerCase(),
                relativePath,
                relativeDirectory: relativeDirectory === "." ? "" : relativeDirectory,
              });
            } catch {
              // Skip inaccessible entries and keep scanning.
            }
          }

          candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN"));
          return { candidates, supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS] };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      },
    ),
    [IpcChannel.File_Exists]: t.procedure.input<{ path?: string }>().action(async ({ input }) => {
      const targetPath = input?.path?.trim();
      if (!targetPath) {
        return { exists: false };
      }

      try {
        const stats = await stat(targetPath);
        return { exists: stats.isFile() };
      } catch {
        return { exists: false };
      }
    }),
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
    [IpcChannel.File_NfoRead]: t.procedure
      .input<{ nfoPath?: string; videoPath?: string }>()
      .action(async ({ input }) => {
        try {
          const nfoPath = input?.nfoPath?.trim();
          if (!nfoPath) {
            throw createIpcError(IpcErrorCode.PARSE_ERROR, "NFO path is required");
          }
          const config = await configManager.getValidated();
          const candidates = getNfoReadCandidates(nfoPath, config.download.nfoNaming, input.videoPath?.trim());
          for (const candidate of candidates) {
            if (!(await pathExists(candidate))) continue;
            const content = await readFile(candidate, "utf8");
            return { data: parseNfoSnapshot(content).crawlerData, nfoPath: candidate };
          }
          throw Object.assign(new Error(`NFO not found: ${nfoPath}`), { code: "ENOENT" });
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.File_NfoWrite]: t.procedure
      .input<{ nfoPath?: string; videoPath?: string; data?: CrawlerData }>()
      .action(async ({ input }): Promise<{ success: true; nfoPath: string }> => {
        try {
          const nfoPath = input?.nfoPath?.trim();
          const data = input?.data;
          if (!nfoPath || !data) {
            throw createIpcError(IpcErrorCode.FILE_WRITE_ERROR, "NFO path and data are required");
          }
          const config = await configManager.getValidated();
          const videoPath = input.videoPath?.trim();
          const plannedNfoPath = resolveFilenameNfoPath(nfoPath, videoPath);
          const existingNfoPath = await findExistingNfoPath(nfoPath, config.download.nfoNaming, pathExists, videoPath);
          const existingXml = existingNfoPath ? await readFile(existingNfoPath, "utf8") : undefined;
          const existingSnapshot = existingXml ? parseNfoSnapshot(existingXml).localState : undefined;
          const options = {
            localState: existingSnapshot,
            nfoNaming: config.download.nfoNaming,
            enabledFields: nfoIgnoreFieldsToEnabledFields(config.download.nfoIgnoreFields),
            nfoTitleTemplate: config.naming.nfoTitleTemplate,
          };
          const xml = existingXml
            ? nfoGenerator.mergeEditableXml(existingXml, data, options)
            : nfoGenerator.buildXml(data, options);
          const paths = getNfoWritePaths(plannedNfoPath, config.download.nfoNaming);
          for (const requiredPath of paths.requiredPaths) await atomicWriteFile(requiredPath, xml);
          for (const stalePath of paths.stalePaths) await rm(stalePath, { force: true });
          return { success: true as const, nfoPath: paths.canonicalPath };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.File_PosterCropSession]: t.procedure.input<{ videoPath?: string }>().action(async ({ input }) => {
      try {
        const videoPath = input?.videoPath?.trim();
        if (!videoPath) throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Video path is required");
        const config = await configManager.getValidated();
        return await posterCropService.prepare(videoPath, config.naming.assetNamingMode);
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.File_PosterCropSave]: t.procedure
      .input<{ videoPath?: string; crop?: NormalizedCropRegion }>()
      .action(async ({ input }) => {
        try {
          const videoPath = input?.videoPath?.trim();
          if (!videoPath || !input?.crop) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Video path and crop are required");
          }
          const config = await configManager.getValidated();
          return await posterCropService.save(videoPath, config.naming.assetNamingMode, input.crop);
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
  };
};
