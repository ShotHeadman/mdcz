import { isAbsoluteLocalPath } from "./localPath";

const isSupportedImageScheme = (value: string): boolean => /^(?:https?:|data:|blob:|local-file:|file:)/u.test(value);

export const normalizeImageSourcePath = (rawPath: string): string => {
  const value = rawPath.trim();
  // Only a value that is itself a file URL is rewritten: resolving a relative path against a `file://` page would
  // turn `ABC-123/poster.jpg` into `/ABC-123/poster.jpg`, which no media root contains.
  const parsed = /^file:/iu.test(value) ? URL.parse(value) : null;
  if (!parsed) return value;
  if (parsed.host) return `//${parsed.host}${decodeURIComponent(parsed.pathname)}`;
  const pathname = decodeURIComponent(parsed.pathname);
  return /^\/[A-Za-z]:\//u.test(pathname) ? pathname.slice(1) : pathname;
};

export const hasExplicitUnsupportedImageScheme = (value: string): boolean =>
  !/^[a-z]:[\\/]/iu.test(value) && !isSupportedImageScheme(value) && /^[a-z][a-z\d+.-]*:/iu.test(value);

export const isDirectRenderableImageSource = (value: string): boolean =>
  /^(?:https?:|data:|blob:|local-file:)/u.test(value);

export const resolveImagePath = (rawPath: string | undefined, baseDir?: string): string => {
  if (!rawPath) return "";
  const path = normalizeImageSourcePath(rawPath);
  if (!path || isSupportedImageScheme(path) || isAbsoluteLocalPath(path) || hasExplicitUnsupportedImageScheme(path)) {
    return path;
  }
  if (!baseDir) return path;

  const separator = baseDir.lastIndexOf("\\") > baseDir.lastIndexOf("/") ? "\\" : "/";
  const normalizedBase = baseDir.replace(/[\\/]+$/u, "");
  const normalizedRelative = path.replace(/^[\\/]+/u, "");
  if (!normalizedBase) return normalizedRelative;
  if (!normalizedRelative) return normalizedBase;
  return `${normalizedBase}${separator}${normalizedRelative}`;
};

export const dedupeMediaSources = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);
