import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { ServiceContainer } from "@main/container";
import { localFileUrlForHostPath } from "@main/localFileProtocol";
import { configManager } from "@main/services/config/ConfigManager";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles, pathExists } from "@main/utils/file";
import { resolveRootFile } from "@mdcz/media-store";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { registeredOutputPaths } from "@mdcz/runtime/publication";
import {
  createMediaFileFilter,
  getNfoReadCandidates,
  nfoGenerator,
  PosterCropService,
  registeredPosterCropContext,
  resolveFilenameNfoPath,
  writeNfoPublication,
} from "@mdcz/runtime/scrape";
import { CandidatePreview } from "@mdcz/runtime/tasks";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { SUPPORTED_MEDIA_EXTENSIONS } from "@mdcz/shared/mediaExtensions";
import { toLocalFileUrl } from "@mdcz/shared/mediaRef";
import type { MediaCandidate } from "@mdcz/shared/types";
import { dialog } from "electron";
import { z } from "zod";
import { createIpcError, IpcErrorCode } from "../errors";
import { resolveLocalFileTarget } from "../localFileTarget";
import {
  fileBrowseInputSchema,
  fileExistsInputSchema,
  fileListMediaCandidatesInputSchema,
  fileNfoReadInputSchema,
  fileNfoWriteInputSchema,
  filePosterCropSaveInputSchema,
  filePosterCropSessionInputSchema,
} from "../payloads";
import { asSerializableIpcError, t } from "../shared";

export const createFileHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.File_CancelMediaCandidates
  | typeof IpcChannel.File_ListMediaCandidates
  | typeof IpcChannel.File_Exists
  | typeof IpcChannel.File_Browse
  | typeof IpcChannel.File_NfoRead
  | typeof IpcChannel.File_NfoWrite
  | typeof IpcChannel.File_PosterCropSession
  | typeof IpcChannel.File_PosterCropSave
> => {
  const previews = new CandidatePreview();
  const { windowService, persistenceService } = context;
  const posterCropService = new PosterCropService();
  const mediaRoots = context.mediaRoots ?? createDesktopMediaRootService(persistenceService);
  const ensurePath = async (hostPath: string): Promise<void> => {
    await mediaRoots.ensurePathRecord({ hostPath });
  };
  const publication = async () => {
    const state = await persistenceService.getState();
    return {
      journal: state.repositories.publicationJournal,
      outputs: state.repositories.library,
      library: state.repositories.library,
      repairIssues: state.repositories.libraryRepairIssues,
      roots: await mediaRoots.listRoots(),
    };
  };

  const registeredImagePaths = async (videoPath: string) => {
    const state = await persistenceService.getState();
    return (await registeredPosterCropContext(videoPath, state.repositories.library, (id) => mediaRoots.get(id)))
      .assets;
  };

  return {
    [IpcChannel.File_CancelMediaCandidates]: t.procedure
      .input(z.object({ scanId: z.string().min(1) }))
      .action(async ({ input }) => await previews.cancel(input.scanId)),
    [IpcChannel.File_ListMediaCandidates]: t.procedure.input(fileListMediaCandidatesInputSchema).action(
      async ({
        input,
      }): Promise<{
        candidates: MediaCandidate[];
        supportedExtensions: string[];
        warnings: { count: number; paths: string[] };
      }> =>
        previews.run(input.scanId ?? randomUUID(), async (signal) => {
          try {
            const dirPath = input?.dirPath?.trim();
            const excludeDirPaths =
              input?.excludeDirPaths?.map((path) => path.trim()).filter((path): path is string => Boolean(path)) ?? [];
            if (!dirPath) {
              throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, "Directory path is required");
            }

            const configuration = await configManager.getValidated();
            const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
            if (metadataPath) excludeDirPaths.push(metadataPath);
            const admitted = await mediaRoots.admitDirectory({ hostPath: dirPath });
            const registeredRoots = await mediaRoots.listRoots();

            const generatedStrms = await registeredOutputPaths(
              (await persistenceService.getState()).repositories.library,
              (id) => mediaRoots.get(id),
              "strm",
            );
            const candidates: MediaCandidate[] = [];
            const warnings = { count: 0, paths: [] as string[] };
            await listVideoFiles(
              admitted.hostPath,
              input.recursive,
              DEFAULT_VIDEO_EXTENSIONS,
              signal,
              excludeDirPaths,
              {
                warnings,
                filterFile: createMediaFileFilter(configuration, generatedStrms),
                onFile: (filePath, stats) => {
                  const resolved = resolveRootFile(registeredRoots, filePath);
                  candidates.push({
                    path: filePath,
                    name: basename(filePath),
                    size: stats.size,
                    lastModified: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
                    extension: extname(filePath).replace(/^\./u, "").toLowerCase(),
                    ref: { rootId: resolved.root.id, relativePath: resolved.relativePath },
                  });
                },
              },
            );

            candidates.sort((a, b) => a.ref.relativePath.localeCompare(b.ref.relativePath, "zh-CN"));
            return { candidates, warnings, supportedExtensions: [...SUPPORTED_MEDIA_EXTENSIONS] };
          } catch (error) {
            throw asSerializableIpcError(error);
          }
        }),
    ),
    [IpcChannel.File_Exists]: t.procedure.input(fileExistsInputSchema).action(async ({ input }) => {
      try {
        const target = await resolveLocalFileTarget(context, input.path);
        const targetPath = target.hostPath;
        const stats = await stat(targetPath);
        if (!stats.isFile()) {
          return { exists: false };
        }
        if (target.ref) {
          return { exists: true, url: toLocalFileUrl(target.ref) };
        }
        const roots = await mediaRoots.listRoots();
        const url = localFileUrlForHostPath(targetPath, roots);
        return url ? { exists: true, url } : { exists: true };
      } catch {
        return { exists: false };
      }
    }),
    [IpcChannel.File_Browse]: t.procedure.input(fileBrowseInputSchema).action(async ({ input }) => {
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
    [IpcChannel.File_NfoRead]: t.procedure.input(fileNfoReadInputSchema).action(async ({ input }) => {
      try {
        const { hostPath: nfoPath } = await resolveLocalFileTarget(context, input.nfoPath);
        const videoPath = input.videoPath
          ? (await resolveLocalFileTarget(context, input.videoPath)).hostPath
          : undefined;
        const config = await configManager.getValidated();
        const candidates = getNfoReadCandidates(nfoPath, config.download.nfoNaming, videoPath);
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
      .input(fileNfoWriteInputSchema)
      .action(async ({ input }): Promise<{ success: true; nfoPath: string }> => {
        try {
          const { hostPath: nfoPath } = await resolveLocalFileTarget(context, input.nfoPath);
          const data = input?.data;
          if (!data) {
            throw createIpcError(IpcErrorCode.FILE_WRITE_ERROR, "NFO data is required");
          }
          const config = await configManager.getValidated();
          const videoPath = input.videoPath
            ? (await resolveLocalFileTarget(context, input.videoPath)).hostPath
            : undefined;
          const plannedNfoPath = resolveFilenameNfoPath(nfoPath, videoPath);
          await ensurePath(dirname(plannedNfoPath));
          const canonicalPath = await writeNfoPublication({
            nfoPath,
            videoPath,
            data,
            configuration: config,
            nfoGenerator,
            publication: await publication(),
          });
          return { success: true as const, nfoPath: canonicalPath };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.File_PosterCropSession]: t.procedure
      .input(filePosterCropSessionInputSchema)
      .action(async ({ input }) => {
        try {
          const { hostPath: videoPath } = await resolveLocalFileTarget(context, input.videoPath);
          const config = await configManager.getValidated();
          return await posterCropService.prepare(
            videoPath,
            config.naming.assetNamingMode,
            await registeredImagePaths(videoPath),
          );
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.File_PosterCropSave]: t.procedure.input(filePosterCropSaveInputSchema).action(async ({ input }) => {
      try {
        const { hostPath: videoPath } = await resolveLocalFileTarget(context, input.videoPath);
        if (!input?.crop) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Crop is required");
        }
        await ensurePath(dirname(videoPath));
        const config = await configManager.getValidated();
        return await posterCropService.save(
          videoPath,
          config.naming.assetNamingMode,
          input.crop,
          await publication(),
          await registeredImagePaths(videoPath),
        );
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
  };
};
