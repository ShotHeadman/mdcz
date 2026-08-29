import {
  hasExplicitUnsupportedImageScheme,
  isDirectRenderableImageSource,
  normalizeImageSourcePath,
  resolveImagePath,
} from "@mdcz/shared/imageSource";
import { LOCAL_FILE_SCHEME, toLocalFileUrl } from "@mdcz/shared/mediaRef";

export { normalizeImageSourcePath, resolveImagePath };

export function getLocalImagePath(rawPath: string | undefined, baseDir?: string): string {
  const path = resolveImagePath(rawPath, baseDir);
  if (!path || hasExplicitUnsupportedImageScheme(path) || isDirectRenderableImageSource(path)) {
    return "";
  }

  if (path.startsWith("file://")) {
    return normalizeImageSourcePath(path);
  }

  return path;
}

export function getImageSrc(rawPath: string, rootId?: string | null): string {
  const path = resolveImagePath(rawPath);
  if (!path) return "";
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith(`${LOCAL_FILE_SCHEME}://`)
  ) {
    return path;
  }

  if (hasExplicitUnsupportedImageScheme(path)) {
    return "";
  }

  const resolvedRootId = rootId?.trim();
  if (!resolvedRootId) {
    return "";
  }

  try {
    return toLocalFileUrl({ rootId: resolvedRootId, relativePath: path });
  } catch {
    return "";
  }
}
