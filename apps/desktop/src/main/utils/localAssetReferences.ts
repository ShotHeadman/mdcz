import { join } from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

const isAbsoluteLocalPath = (value: string): boolean => {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) || value.startsWith("/") || value.startsWith("\\\\");
};

export const resolveLocalAssetReference = (directory: string, value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (URI_SCHEME_PATTERN.test(trimmed) && !WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed)) {
    return undefined;
  }

  if (isAbsoluteLocalPath(trimmed)) {
    return trimmed;
  }

  const segments = trimmed.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  return join(directory, ...segments);
};

export const uniqueDefinedPaths = (paths: Array<string | undefined>): string[] => {
  const outputs: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    outputs.push(path);
  }

  return outputs;
};
