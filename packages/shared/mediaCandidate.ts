import type { Configuration } from "./config";
import type { MediaCandidate } from "./types";

export type WorkbenchSetupMode = "scrape" | "maintenance";

export interface MediaCandidateScanPlan {
  recursive: boolean;
  excludeDirPaths: string[];
  extraScanDirs: string[];
  scanKey: string;
}

export const isAbsoluteHostPath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);

export const joinHostPath = (base: string, child: string): string => {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/u, "")}${separator}${child.replace(/^[\\/]+/u, "")}`;
};

export const resolveSuccessTargetDir = (scanDir: string, successOutputFolder: string | undefined): string => {
  const target = successOutputFolder?.trim() ?? "";
  if (!target) {
    return "";
  }
  if (isAbsoluteHostPath(target) || !scanDir.trim()) {
    return target;
  }
  return joinHostPath(scanDir, target);
};

const resolveConfiguredDir = (scanDir: string, configuredPath: string | undefined): string | undefined => {
  const trimmedPath = configuredPath?.trim() ?? "";
  if (!trimmedPath) {
    return undefined;
  }

  return isAbsoluteHostPath(trimmedPath) || !scanDir.trim() ? trimmedPath : joinHostPath(scanDir, trimmedPath);
};

const resolveConfiguredDirs = (scanDir: string, configuredPaths: readonly string[] | undefined): string[] => {
  const outputs: string[] = [];

  for (const configuredPath of configuredPaths ?? []) {
    const resolvedPath = resolveConfiguredDir(scanDir, configuredPath);
    if (resolvedPath) {
      outputs.push(resolvedPath);
    }
  }

  return outputs;
};

const usesWindowsPathSemantics = (rawPath: string, normalizedPath: string): boolean =>
  /^[A-Za-z]:\//u.test(normalizedPath) || rawPath.includes("\\");

export const normalizeComparableHostPath = (path: string): string => {
  const normalized = path
    .trim()
    .replace(/[\\/]+/gu, "/")
    .replace(/\/$/u, "");
  return usesWindowsPathSemantics(path, normalized) ? normalized.toLowerCase() : normalized;
};

export const isHostPathWithinDirectory = (filePath: string, directoryPath: string): boolean => {
  const normalizedFilePath = normalizeComparableHostPath(filePath);
  const normalizedDirectoryPath = normalizeComparableHostPath(directoryPath);
  return normalizedFilePath === normalizedDirectoryPath || normalizedFilePath.startsWith(`${normalizedDirectoryPath}/`);
};

const dedupePathsByComparableKey = (paths: ReadonlyArray<string | undefined>): string[] => {
  const seen = new Set<string>();
  const outputs: string[] = [];
  for (const path of paths) {
    const trimmed = path?.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeComparableHostPath(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    outputs.push(trimmed);
  }
  return outputs;
};

export const resolveMediaCandidateScanPlan = (
  mode: WorkbenchSetupMode,
  scanDir: string,
  recursive: boolean,
  config?: Configuration,
): MediaCandidateScanPlan => {
  const defaultExcludeDirPaths =
    mode === "scrape" ? resolveConfiguredDirs(scanDir, config?.paths?.defaultScanExcludeDirs) : [];
  const softlinkDirPath =
    mode === "scrape" && config?.behavior?.scrapeSoftlinkPath && scanDir.trim()
      ? resolveConfiguredDir(scanDir, config?.paths?.softlinkPath)
      : undefined;

  const excludeDirPaths = dedupePathsByComparableKey(defaultExcludeDirPaths);
  const extraScanDirs =
    softlinkDirPath &&
    normalizeComparableHostPath(softlinkDirPath) !== normalizeComparableHostPath(scanDir) &&
    !(
      recursive &&
      !/(^|[\\/])\.{1,2}([\\/]|$)/u.test(softlinkDirPath) &&
      isHostPathWithinDirectory(softlinkDirPath, scanDir) &&
      !excludeDirPaths.some((excluded) => isHostPathWithinDirectory(softlinkDirPath, excluded))
    )
      ? [softlinkDirPath]
      : [];

  return {
    recursive,
    excludeDirPaths,
    extraScanDirs,
    scanKey: JSON.stringify([
      mode,
      normalizeComparableHostPath(scanDir),
      recursive,
      excludeDirPaths.map(normalizeComparableHostPath),
      extraScanDirs.map(normalizeComparableHostPath),
      config?.scrape?.filenameBlacklistTokens,
    ]),
  };
};

export const mergeMediaCandidates = (...candidateGroups: MediaCandidate[][]): MediaCandidate[] => {
  const outputs: MediaCandidate[] = [];
  const seen = new Set<string>();

  for (const candidates of candidateGroups) {
    for (const candidate of candidates) {
      const key = normalizeComparableHostPath(candidate.path);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      outputs.push(candidate);
    }
  }

  return outputs;
};
