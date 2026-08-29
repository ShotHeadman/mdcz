const isSupportedImageScheme = (value: string): boolean => /^(?:https?:|data:|blob:|local-file:|file:)/u.test(value);

const isAbsoluteLocalPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");

export const normalizeImageSourcePath = (rawPath: string): string => {
  const value = rawPath.trim();
  if (!value) return "";

  try {
    const parsed = new URL(value, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    if (parsed.pathname.endsWith("/api/v1/files/image") || parsed.pathname.endsWith("/api/v1/crop/image")) {
      return parsed.searchParams.get("path") ?? value;
    }
    if (parsed.protocol === "local-file:") return value;
    if (parsed.protocol === "file:") {
      if (parsed.host) return `//${parsed.host}${decodeURIComponent(parsed.pathname)}`;
      const pathname = decodeURIComponent(parsed.pathname);
      return /^\/[A-Za-z]:\//u.test(pathname) ? pathname.slice(1) : pathname;
    }
  } catch {
    return value;
  }

  return value;
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
