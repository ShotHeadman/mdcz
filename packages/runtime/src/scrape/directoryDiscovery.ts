import { basename, extname } from "node:path";
import { type FileWalkOptions, resolveRootFile, walkFiles } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { DirectoryTaskScope, DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { hasLiteralFilenameToken } from "@mdcz/shared/filenameTokens";
import { resolveMediaCandidateScanPlan, type WorkbenchSetupMode } from "@mdcz/shared/mediaCandidate";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { publicationPathKey } from "../publication/boundary";
import { runtimeLoggerService } from "../shared";
import { DEFAULT_VIDEO_EXTENSIONS } from "./utils/filesystem";

export const createDirectoryScope = (
  source: { scanDir: string; recursive: boolean },
  targetDir: string,
  configuration: Configuration,
  mode: WorkbenchSetupMode = "scrape",
): DirectoryTaskScope => {
  const plan = resolveMediaCandidateScanPlan(mode, source.scanDir, source.recursive, configuration);
  return {
    kind: "directory",
    ...source,
    targetDir,
    extraScanDirs: plan.extraScanDirs,
    excludeDirPaths: [
      ...new Set(
        [
          ...plan.excludeDirPaths,
          configuration.paths.metadataPath.trim(),
          ...(mode === "scrape" && targetDir !== source.scanDir ? [targetDir] : []),
        ].filter(Boolean),
      ),
    ],
  };
};

export const createMediaFileFilter =
  (
    configuration: Configuration,
    generatedStrms: ReadonlySet<string>,
    extensions = DEFAULT_VIDEO_EXTENSIONS,
  ): NonNullable<FileWalkOptions["filterFile"]> =>
  (filePath) =>
    extensions.has(extname(filePath).toLowerCase()) &&
    isPrimaryVideoFileName(filePath) &&
    !generatedStrms.has(publicationPathKey(filePath)) &&
    !hasLiteralFilenameToken(basename(filePath), configuration.scrape.filenameBlacklistTokens);

export const discoverDirectoryFiles = async (input: {
  scope: DirectoryTaskScope;
  configuration: Configuration;
  mediaRoots: ConfiguredMediaRootService;
  generatedStrms: ReadonlySet<string>;
  signal: AbortSignal;
  platform: "desktop" | "server";
  onProgress: (progress: DiscoveryProgress) => void;
}): Promise<{ refs: RootFileRef[]; discovery: DiscoveryProgress }> => {
  const { scope, signal } = input;
  const started = performance.now();
  const paths = new Set<string>();
  const warnings = { count: 0, paths: [] as string[] };
  let directories = 0;
  let candidates = 0;
  let discovery: DiscoveryProgress = {
    directories: 0,
    candidates: 0,
    skipped: 0,
    elapsedMs: 0,
    currentPath: scope.scanDir,
    warnings: [],
  };
  for (const directory of [scope.scanDir, ...scope.extraScanDirs]) {
    signal.throwIfAborted();
    await input.mediaRoots.registerPathIntent(directory);
    const found = await walkFiles(directory, scope.recursive, signal, {
      filterFile: createMediaFileFilter(input.configuration, input.generatedStrms),
      excludeDirectoryPaths: scope.excludeDirPaths,
      deduplicateDirectories: input.platform === "desktop",
      excludeFileSymlinks: input.platform === "server",
      warnings,
      onDiagnostic:
        process.env.MDCZ_SCAN_DIAGNOSTICS === "1"
          ? (message) => runtimeLoggerService.getLogger("DirectoryDiscovery").info(message)
          : undefined,
      onProgress: (progress) => {
        discovery = {
          ...progress,
          directories: directories + progress.directories,
          candidates: candidates + progress.candidates,
          elapsedMs: Math.round(performance.now() - started),
        };
        input.onProgress(discovery);
      },
    });
    directories = discovery.directories;
    candidates = discovery.candidates;
    for (const path of found) paths.add(path);
  }
  signal.throwIfAborted();
  const roots = await input.mediaRoots.listRoots();
  const refs = new Map<string, RootFileRef>();
  for (const file of paths) {
    const resolved = resolveRootFile(roots, file);
    const ref = { rootId: resolved.root.id, relativePath: resolved.relativePath };
    refs.set(`${ref.rootId}\0${ref.relativePath}`, ref);
  }
  discovery = { ...discovery, candidates: refs.size, currentPath: null };
  input.onProgress(discovery);
  return { refs: [...refs.values()], discovery };
};
