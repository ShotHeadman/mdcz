import { randomUUID } from "node:crypto";
import { readdir, readFile, rmdir, stat } from "node:fs/promises";
import { basename, dirname, extname, posix } from "node:path";
import type { ServiceContainer } from "@main/container";
import { localFileUrlForHostPath } from "@main/localFileProtocol";
import { configManager } from "@main/services/config/ConfigManager";
import { loggerService } from "@main/services/LoggerService";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { toErrorMessage } from "@main/utils/common";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles, pathExists } from "@main/utils/file";
import { listRootFiles, resolveRootFile, resolveRootRelativePath } from "@mdcz/media-store";
import { buildMovieTags, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import {
  commitPublishedMedia,
  commitRegisteredPublication,
  registeredOutputPaths,
  resolveRegisteredNfoPaths,
} from "@mdcz/runtime/publication";
import {
  createMediaFileFilter,
  findExistingNfoPath,
  getNfoReadCandidates,
  getNfoWritePaths,
  nfoGenerator,
  nfoIgnoreFieldsToEnabledFields,
  PosterCropService,
  resolveFilenameNfoPath,
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
  fileDeleteInputSchema,
  fileExistsInputSchema,
  fileListMediaCandidatesInputSchema,
  fileNfoReadInputSchema,
  fileNfoWriteInputSchema,
  filePosterCropSaveInputSchema,
  filePosterCropSessionInputSchema,
} from "../payloads";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

export const createFileHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.File_CancelMediaCandidates
  | typeof IpcChannel.File_ListMediaCandidates
  | typeof IpcChannel.File_Exists
  | typeof IpcChannel.File_Browse
  | typeof IpcChannel.File_Delete
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
      repairIssues: state.repositories.libraryRepairIssues,
      roots: await mediaRoots.listRoots(),
    };
  };

  const registeredImagePaths = async (videoPath: string) => {
    const state = await persistenceService.getState();
    const source = await state.repositories.library.resolveMaintenanceSource(videoPath);
    if (!source) throw new Error("封面编辑需要已登记的媒体资源");
    const entry = await state.repositories.library.getEntryById(source.libraryItemId);
    const paths: { thumb?: string; poster?: string } = {};
    for (const asset of entry.assets) {
      if ((asset.kind === "thumb" || asset.kind === "poster") && asset.rootId && asset.relativePath)
        paths[asset.kind] = resolveRootRelativePath(await mediaRoots.get(asset.rootId), asset.relativePath);
    }
    return paths;
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
            if (configuration.paths.metadataPath.trim()) excludeDirPaths.push(configuration.paths.metadataPath.trim());
            await ensurePath(dirPath);
            const registeredRoots = await mediaRoots.listRoots();

            const generatedStrms = await registeredOutputPaths(
              (await persistenceService.getState()).repositories.library,
              (id) => mediaRoots.get(id),
              "strm",
            );
            const candidates: MediaCandidate[] = [];
            const warnings = { count: 0, paths: [] as string[] };
            await listVideoFiles(dirPath, input.recursive, DEFAULT_VIDEO_EXTENSIONS, signal, excludeDirPaths, {
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
            });

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
    [IpcChannel.File_Delete]: t.procedure
      .input(fileDeleteInputSchema)
      .action(async ({ input }): Promise<{ deletedCount: number; failedCount: number }> => {
        if (input.containingFolder && input.targets.length !== 1) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Deleting a containing folder requires one file");
        }
        const state = await persistenceService.getState();
        const roots = await mediaRoots.listRoots();
        const canonicalizeRef = (ref: (typeof input.targets)[number]) => {
          const referencedRoot = roots.find((root) => root.id === ref.rootId);
          if (!referencedRoot) throw new Error(`Media root not found: ${ref.rootId}`);
          const resolved = resolveRootFile(roots, resolveRootRelativePath(referencedRoot, ref.relativePath));
          return { rootId: resolved.root.id, relativePath: resolved.relativePath };
        };
        const publishDeletion = async (refs: Array<{ rootId: string; relativePath: string }>, operationId: string) => {
          await commitPublishedMedia(
            {
              operationId,
              operationType: "maintenance",
              artifacts: [],
              assets: [],
              obsolete: [],
              deleteFiles: refs,
            },
            {
              resolveRoot: async (rootId) => await mediaRoots.get(rootId),
              journal: state.repositories.publicationJournal,
              outputs: state.repositories.library,
              repairIssues: state.repositories.libraryRepairIssues,
              commit: () => state.repositories.library.deleteFiles(refs),
            },
          );
        };

        if (input.containingFolder) {
          const target = input.targets[0];
          if (!target) throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "File target is required");
          const ref = canonicalizeRef(target);
          const parentPath = posix.dirname(ref.relativePath);
          if (parentPath === "." || parentPath === "") {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Cannot delete a media root directory");
          }
          const root = await mediaRoots.get(ref.rootId);
          const files = await listRootFiles(root, parentPath, true);
          await publishDeletion(
            files.map((file) => ({ rootId: root.id, relativePath: file.relativePath })),
            `delete-folder:${root.id}:${parentPath}`,
          );
          const directory = resolveRootRelativePath(root, parentPath);
          const remaining = await readdir(directory, { recursive: true, withFileTypes: true });
          for (const child of remaining
            .filter((entry) => entry.isDirectory())
            .sort((a, b) => b.parentPath.length - a.parentPath.length))
            await rmdir(`${child.parentPath}/${child.name}`);
          await rmdir(directory);
          return { deletedCount: files.length, failedCount: 0 };
        }

        let deletedCount = 0;
        let failedCount = 0;

        for (const target of input.targets) {
          try {
            const ref = canonicalizeRef(target);
            await publishDeletion([ref], `delete:${ref.rootId}:${ref.relativePath}`);
            deletedCount += 1;
          } catch (error) {
            failedCount += 1;
            logger.warn(`Failed to delete file: ${toErrorMessage(error)}`);
          }
        }

        return { deletedCount, failedCount };
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
          const existingNfoPath = await findExistingNfoPath(nfoPath, config.download.nfoNaming, pathExists, videoPath);
          const existingXml = existingNfoPath ? await readFile(existingNfoPath, "utf8") : undefined;
          const existingSnapshot = existingXml ? parseNfoSnapshot(existingXml).localState : undefined;
          const options = {
            localState: existingSnapshot,
            nfoNaming: config.download.nfoNaming,
            enabledFields: nfoIgnoreFieldsToEnabledFields(config.download.nfoIgnoreFields),
            nfoTitleTemplate: config.naming.nfoTitleTemplate,
            buildTags: buildMovieTags,
          };
          const xml = existingXml
            ? nfoGenerator.mergeEditableXml(existingXml, data, options)
            : nfoGenerator.buildXml(data, options);
          const state = await persistenceService.getState();
          const ownedNfo = await resolveRegisteredNfoPaths(nfoPath, state.repositories.library, (id) =>
            state.repositories.mediaRoots.get(id),
          );
          const paths = getNfoWritePaths(plannedNfoPath, config.download.nfoNaming);
          if (ownedNfo) {
            paths.requiredPaths = ownedNfo.paths;
            paths.canonicalPath = nfoPath;
          }
          await commitRegisteredPublication(
            {
              operationId: `nfo-write:${plannedNfoPath}`,
              mediaPaths: ownedNfo?.mediaPaths,
              operationType: "maintenance",
              artifacts: paths.requiredPaths.map((targetPath) => ({
                targetPath,
                content: { kind: "text" as const, data: xml },
              })),
              replaceExistingArtifacts: true,
              editExistingFiles: true,
              readOnlyDirectories:
                ownedNfo?.readOnlyDirectories ??
                (videoPath && dirname(videoPath) !== dirname(plannedNfoPath) ? [dirname(videoPath)] : []),
            },
            await publication(),
          );
          return { success: true as const, nfoPath: paths.canonicalPath };
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
