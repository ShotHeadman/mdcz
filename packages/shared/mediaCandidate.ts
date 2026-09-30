import type { Configuration } from "./config";

export type WorkbenchSetupMode = "scrape" | "maintenance";

export interface MediaCandidateScanPlan {
  recursive: boolean;
  excludeDirPaths: string[];
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
  const excludeDirPaths = dedupePathsByComparableKey(defaultExcludeDirPaths);
  return {
    recursive,
    excludeDirPaths,
    scanKey: JSON.stringify([
      mode,
      normalizeComparableHostPath(scanDir),
      recursive,
      excludeDirPaths.map(normalizeComparableHostPath),
      config?.scrape?.filenameBlacklistTokens,
    ]),
  };
};
