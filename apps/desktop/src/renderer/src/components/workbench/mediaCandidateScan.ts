import type { MediaCandidate } from "@mdcz/shared/types";
import type { ConfigOutput } from "@/client/types";

export type WorkbenchSetupMode = "scrape" | "maintenance";

interface MediaCandidateScanPlan {
  excludeDirPath?: string;
  filterDirPaths: string[];
  extraScanDirs: string[];
  scanKey: string;
}

const isAbsolutePath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);

const joinPath = (base: string, child: string): string => {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/u, "")}${separator}${child.replace(/^[\\/]+/u, "")}`;
};

const resolveConfiguredDir = (scanDir: string, configuredPath: string | undefined): string | undefined => {
  const trimmedPath = configuredPath?.trim() ?? "";
  if (!trimmedPath) {
    return undefined;
  }

  return isAbsolutePath(trimmedPath) || !scanDir.trim() ? trimmedPath : joinPath(scanDir, trimmedPath);
};

const usesWindowsPathSemantics = (rawPath: string, normalizedPath: string): boolean =>
  /^[A-Za-z]:\//u.test(normalizedPath) || rawPath.includes("\\");

const normalizeComparablePath = (path: string): string => {
  const normalized = path
    .trim()
    .replace(/[\\/]+/gu, "/")
    .replace(/\/$/u, "");
  return usesWindowsPathSemantics(path, normalized) ? normalized.toLowerCase() : normalized;
};

const isPathWithinDirectory = (filePath: string, directoryPath: string): boolean => {
  const normalizedFilePath = normalizeComparablePath(filePath);
  const normalizedDirectoryPath = normalizeComparablePath(directoryPath);
  return normalizedFilePath === normalizedDirectoryPath || normalizedFilePath.startsWith(`${normalizedDirectoryPath}/`);
};

export const resolveMediaCandidateScanPlan = (
  mode: WorkbenchSetupMode,
  scanDir: string,
  targetDir: string | undefined,
  config?: ConfigOutput,
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
    softlinkDirPath && normalizeComparablePath(softlinkDirPath) !== normalizeComparablePath(scanDir)
      ? [softlinkDirPath]
      : [];

  return {
    excludeDirPath,
    filterDirPaths,
    extraScanDirs,
    scanKey: [...filterDirPaths, ...extraScanDirs].map(normalizeComparablePath).join("|"),
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
    (candidate) => !excludeDirPaths.some((directoryPath) => isPathWithinDirectory(candidate.path, directoryPath)),
  );
};

export const mergeMediaCandidates = (...candidateGroups: MediaCandidate[][]): MediaCandidate[] => {
  const outputs: MediaCandidate[] = [];
  const seen = new Set<string>();

  for (const candidates of candidateGroups) {
    for (const candidate of candidates) {
      const key = normalizeComparablePath(candidate.path);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      outputs.push(candidate);
    }
  }

  return outputs;
};
