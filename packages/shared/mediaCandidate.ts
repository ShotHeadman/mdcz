import type { Configuration } from "./config";
import type { MediaCandidate } from "./types";

export type WorkbenchSetupMode = "scrape" | "maintenance";

export interface MediaCandidateScanPlan {
  excludeDirPath?: string;
  filterDirPaths: string[];
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

export const resolveMediaCandidateScanPlan = (
  mode: WorkbenchSetupMode,
  scanDir: string,
  targetDir: string | undefined,
  config?: Configuration,
): MediaCandidateScanPlan => {
  const excludeDirPath = mode === "scrape" ? targetDir?.trim() || undefined : undefined;
  if (mode !== "scrape") {
    return {
      excludeDirPath,
      filterDirPaths: excludeDirPath ? [excludeDirPath] : [],
      extraScanDirs: [],
      scanKey: excludeDirPath ?? "",
    };
  }

  const failedDirPath = resolveConfiguredDir(scanDir, config?.paths?.failedOutputFolder);
  const softlinkDirPath =
    config?.behavior?.scrapeSoftlinkPath && scanDir.trim()
      ? resolveConfiguredDir(scanDir, config?.paths?.softlinkPath)
      : undefined;
  const filterDirPaths = [excludeDirPath, failedDirPath].filter((path): path is string => Boolean(path?.trim()));
  const extraScanDirs =
    softlinkDirPath && normalizeComparableHostPath(softlinkDirPath) !== normalizeComparableHostPath(scanDir)
      ? [softlinkDirPath]
      : [];

  return {
    excludeDirPath,
    filterDirPaths,
    extraScanDirs,
    scanKey: [...filterDirPaths, ...extraScanDirs].map(normalizeComparableHostPath).join("|"),
  };
};

export const filterMediaCandidates = (
  candidates: MediaCandidate[],
  excludeDirPaths: readonly string[],
): MediaCandidate[] => {
  if (excludeDirPaths.length === 0) {
    return candidates;
  }

  return candidates.filter(
    (candidate) => !excludeDirPaths.some((directoryPath) => isHostPathWithinDirectory(candidate.path, directoryPath)),
  );
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
