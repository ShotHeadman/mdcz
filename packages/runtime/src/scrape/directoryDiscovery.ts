import { realpath } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { type FileWalkOptions, isPathInside, resolveRootFile, walkFiles } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { DirectoryTaskScope, DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { hasLiteralFilenameToken } from "@mdcz/shared/filenameTokens";
import { resolveMediaCandidateScanPlan, type WorkbenchSetupMode } from "@mdcz/shared/mediaCandidate";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { publicationPathKey } from "../publication/paths";
import { runtimeLoggerService } from "../shared";
import { DirectoryInventory } from "./DirectoryInventory";
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
    excludeDirPaths: [
      ...new Set(
        [
          ...plan.excludeDirPaths,
          configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "",
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
}): Promise<{ refs: RootFileRef[]; discovery: DiscoveryProgress; inventory: DirectoryInventory }> => {
  const { scope, signal } = input;
  const started = performance.now();
  const warnings = { count: 0, paths: [] as string[] };
  const inventory = new DirectoryInventory();
  for (const path of input.generatedStrms) inventory.generatedStrms.add(await inventory.entryPath(path));
  const canonicalDirectories = new Map<string, string>();
  const found: string[] = [];
  let discovery: DiscoveryProgress = {
    directories: 0,
    candidates: 0,
    skipped: 0,
    elapsedMs: 0,
    currentPath: scope.scanDir,
    warnings: [],
  };
  signal.throwIfAborted();
  const root = await input.mediaRoots.registerPathIntent(scope.scanDir);
  await input.mediaRoots.assertRootIntegrity([root.id]);
  const output = await input.mediaRoots.prepareOutputDirectory({ hostPath: scope.targetDir });
  if (output.id !== root.id) await input.mediaRoots.assertRootIntegrity([output.id]);
  const scanPath = await realpath(scope.scanDir);
  const namespaceScanPath =
    root.realPath && isPathInside(root.realPath, scanPath)
      ? join(root.hostPath, relative(root.realPath, scanPath))
      : scope.scanDir;
  await walkFiles(namespaceScanPath, scope.recursive, signal, {
    onDirectory: (directory, canonical, entries) => {
      inventory.observeDirectory(directory, canonical, entries);
      canonicalDirectories.set(directory, canonical);
    },
    onFile: (file, facts) => {
      const directory = canonicalDirectories.get(dirname(file));
      if (!directory) throw new Error(`Discovery directory was not inventoried: ${file}`);
      inventory.observeFile(join(directory, basename(file)), facts);
      found.push(file);
    },
    filterFile: async (file) =>
      createMediaFileFilter(input.configuration, input.generatedStrms)(file) &&
      (extname(file).toLowerCase() !== ".strm" ||
        (await inventory.mediaEntries(dirname(file))).some((entry) => entry.name === basename(file))),
    excludeDirectoryPaths: scope.excludeDirPaths,
    deduplicateDirectories: true,
    excludeFileSymlinks: input.platform === "server",
    warnings,
    onDiagnostic:
      process.env.MDCZ_SCAN_DIAGNOSTICS === "1"
        ? (message) => runtimeLoggerService.getLogger("DirectoryDiscovery").info(message)
        : undefined,
    onProgress: (progress) => {
      discovery = { ...progress, elapsedMs: Math.round(performance.now() - started) };
      input.onProgress(discovery);
    },
  });
  signal.throwIfAborted();
  const roots = await input.mediaRoots.listRoots();
  const refs = new Map<string, RootFileRef>();
  for (const file of found.sort((left, right) => left.localeCompare(right, "zh-CN"))) {
    const resolved = resolveRootFile(roots, file);
    const ref = { rootId: resolved.root.id, relativePath: resolved.relativePath };
    refs.set(`${ref.rootId}\0${ref.relativePath}`, ref);
  }
  await input.mediaRoots.assertRootIntegrity(
    new Set([...refs.values()].map((ref) => ref.rootId).filter((id) => id !== root.id && id !== output.id)),
  );
  discovery = { ...discovery, candidates: refs.size, currentPath: null };
  input.onProgress(discovery);
  const admitted = await inventory.admitRefs([...refs.values()], async (id) => {
    const root = roots.find((root) => root.id === id);
    if (!root) throw new Error(`Media root not found: ${id}`);
    return root;
  });
  return { refs: admitted, discovery, inventory };
};
