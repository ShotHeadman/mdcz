export function normalizeImageSourcePath(rawPath: string): string {
  const value = rawPath.trim();
  if (!value) return "";

  try {
    const parsed = new URL(value, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (parsed.pathname.endsWith("/api/v1/files/image") || parsed.pathname.endsWith("/api/v1/crop/image")) {
      const path = parsed.searchParams.get("path");
      if (path) {
        return path;
      }
    }

    if (parsed.protocol === "file:" || parsed.protocol === "local-file:") {
      if (parsed.host) {
        return `//${parsed.host}${decodeURIComponent(parsed.pathname)}`;
      }

      const pathname = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//u.test(pathname)) {
        return pathname.slice(1);
      }
      return pathname;
    }
  } catch {
    // Not a URL, treat it as a local file path.
  }

  return value;
}

const isSupportedRemoteImageScheme = (value: string): boolean => {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("local-file://") ||
    value.startsWith("file://")
  );
};

const hasExplicitUnsupportedScheme = (value: string): boolean => {
  if (/^[a-z]:[\\/]/iu.test(value)) {
    return false;
  }

  if (isSupportedRemoteImageScheme(value)) {
    return false;
  }

  return /^[a-z][a-z\d+.-]*:/iu.test(value);
};

const isDirectRenderableRemoteImageSource = (value: string): boolean => {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  );
};

const isAbsoluteLocalPath = (value: string): boolean => {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");
};

const joinRelativePath = (baseDir: string, relativePath: string): string => {
  const separator = baseDir.lastIndexOf("\\") > baseDir.lastIndexOf("/") ? "\\" : "/";
  const normalizedBase = baseDir.replace(/[\\/]+$/u, "");
  const normalizedRelative = relativePath.replace(/^[\\/]+/u, "");

  if (!normalizedBase) {
    return normalizedRelative;
  }

  if (!normalizedRelative) {
    return normalizedBase;
  }

  return `${normalizedBase}${separator}${normalizedRelative}`;
};

const buildSiblingPath = (filePath: string, fileName: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const separator = filePath.lastIndexOf("\\") > filePath.lastIndexOf("/") ? "\\" : "/";
  if (slash < 0) {
    return fileName;
  }

  return `${filePath.slice(0, slash)}${separator}${fileName}`;
};

const getImageBaseDir = (filePath: string | undefined, outputPath: string | undefined): string => {
  if (outputPath) {
    return outputPath;
  }

  if (!filePath) {
    return "";
  }

  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash < 0) {
    return "";
  }

  return filePath.slice(0, slash) || filePath[0] || "";
};

export const buildLocalImageCandidate = (
  filePath: string | undefined,
  outputPath: string | undefined,
  fileName: string,
): string => {
  if (outputPath) {
    const separator = outputPath.lastIndexOf("\\") > outputPath.lastIndexOf("/") ? "\\" : "/";
    return `${outputPath}${separator}${fileName}`;
  }

  if (filePath) {
    return buildSiblingPath(filePath, fileName);
  }

  return "";
};

export interface ImageSourceCandidatesInput {
  remotePath?: string;
  filePath?: string;
  outputPath?: string;
  fileName: string;
}

export const buildImageSourceCandidates = (
  input: ImageSourceCandidatesInput,
): { primary: string; fallback: string } => {
  const fallback = buildLocalImageCandidate(input.filePath, input.outputPath, input.fileName);
  const baseDir = getImageBaseDir(input.filePath, input.outputPath);
  const primary = resolveImagePath(input.remotePath, baseDir) || fallback;

  return {
    primary,
    fallback,
  };
};

export function resolveImagePath(rawPath: string | undefined, baseDir?: string): string {
  if (!rawPath) {
    return "";
  }

  const path = normalizeImageSourcePath(rawPath);
  if (!path) {
    return "";
  }

  if (isSupportedRemoteImageScheme(path) || isAbsoluteLocalPath(path) || hasExplicitUnsupportedScheme(path)) {
    return path;
  }

  return baseDir ? joinRelativePath(baseDir, path) : path;
}

export function getLocalImagePath(rawPath: string | undefined, baseDir?: string): string {
  const path = resolveImagePath(rawPath, baseDir);
  if (!path || hasExplicitUnsupportedScheme(path) || isDirectRenderableRemoteImageSource(path)) {
    return "";
  }

  if (path.startsWith("file://") || path.startsWith("local-file://")) {
    return normalizeImageSourcePath(path);
  }

  return path;
}

/**
 * Convert an absolute file path into a `local-file://` URL.
 *
 * The custom `local-file` protocol is registered in the Electron main process
 * and proxies requests to the local filesystem via `net.fetch`, which avoids
 * cross-origin `file://` blocking when the renderer is loaded from
 * `http://localhost` during development.
 */
function toFileUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  if (!normalized) {
    return "";
  }

  // Already using our custom scheme — pass through.
  if (normalized.startsWith("local-file://")) {
    return normalized;
  }

  // Strip existing file:// prefix if present, we'll re-wrap below.
  const stripped = normalized.startsWith("file://") ? decodeURI(normalized.slice("file://".length)) : null;
  const target = stripped ?? normalized;

  // Windows drive letter: C:/...
  if (/^[A-Za-z]:\//u.test(target)) {
    return `local-file:///${encodeURI(target)}`;
  }

  // UNC path: //server/share
  if (target.startsWith("//")) {
    return `local-file:${encodeURI(target)}`;
  }

  // Unix absolute path: /home/...
  if (target.startsWith("/")) {
    return `local-file://${encodeURI(target)}`;
  }

  return `local-file://${encodeURI(`/${target}`)}`;
}

export function getImageSrc(rawPath: string): string {
  const path = resolveImagePath(rawPath);
  if (!path) return "";
  if (isSupportedRemoteImageScheme(path)) {
    return path;
  }

  if (hasExplicitUnsupportedScheme(path)) {
    return "";
  }

  return toFileUrl(path);
}
