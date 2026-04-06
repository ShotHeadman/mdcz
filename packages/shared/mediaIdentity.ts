const normalizeDriveLetter = (path: string): string =>
  path.replace(/^([A-Za-z]):/u, (_, drive: string) => `${drive.toUpperCase()}:`);

const collapseSlashes = (path: string): string => path.replace(/\\/gu, "/").replace(/\/+/gu, "/");

const trimTrailingSlashes = (path: string): string => {
  if (path === "/") {
    return path;
  }

  if (/^[A-Za-z]:\/$/u.test(path)) {
    return path;
  }

  return path.replace(/\/+$/u, "");
};

export const normalizePathForIdentity = (filePath: string): string => {
  const normalized = collapseSlashes(normalizeDriveLetter(filePath.trim()));
  if (!normalized) {
    return "";
  }

  return trimTrailingSlashes(normalized);
};

export const buildFileId = (filePath: string): string => `file:${normalizePathForIdentity(filePath)}`;

export const deriveGroupingDirectoryFromPath = (filePath: string): string | undefined => {
  const normalizedPath = normalizePathForIdentity(filePath);
  if (!normalizedPath) {
    return undefined;
  }

  const slash = normalizedPath.lastIndexOf("/");
  if (slash < 0) {
    return undefined;
  }

  if (slash === 0) {
    return normalizedPath[0];
  }

  return normalizedPath.slice(0, slash);
};

export const normalizeGroupingDirectory = (directory: string): string =>
  trimTrailingSlashes(normalizePathForIdentity(directory));

export const buildStandaloneGroupId = (fileId: string): string => `standalone:${fileId}`;

export const buildGroupedGroupId = (directory: string, number: string): string => {
  return `${normalizeGroupingDirectory(directory)}::${number.trim().toUpperCase()}`;
};

export const tryBuildGroupedGroupId = (input: { directory?: string; number: string }): string | undefined => {
  const number = input.number.trim().toUpperCase();
  const directory = input.directory?.trim();
  if (!number || !directory) {
    return undefined;
  }

  return buildGroupedGroupId(directory, number);
};
