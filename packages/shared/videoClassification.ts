import { SUPPORTED_MEDIA_EXTENSIONS_WITH_DOT } from "./mediaExtensions";

const VIDEO_EXTENSION_SET = new Set(SUPPORTED_MEDIA_EXTENSIONS_WITH_DOT.map((extension) => extension.toLowerCase()));

export type VideoClassification = "video" | "non-video";

export const isSupportedVideoExtension = (extension: string): boolean => {
  const normalized = extension.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return VIDEO_EXTENSION_SET.has(normalized.startsWith(".") ? normalized : `.${normalized}`);
};

const fileExtension = (fileName: string): string => {
  const baseName = fileName.replace(/^.*[/\\]/u, "");
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex > 0 ? baseName.slice(dotIndex) : "";
};

export const isVideoFileName = (fileName: string): boolean => isSupportedVideoExtension(fileExtension(fileName));

export const classifyFileName = (fileName: string): VideoClassification =>
  isVideoFileName(fileName) ? "video" : "non-video";
