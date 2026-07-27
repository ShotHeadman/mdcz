export {
  DEFAULT_VIDEO_EXTENSIONS,
  ensureParentDirectory,
  hasEnoughDiskSpace,
  listFiles,
  listVideoFiles,
  moveFileSafely,
  pathExists,
  resolveAvailablePath,
} from "@mdcz/runtime/scrape/utils/filesystem";

export const imageContentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
};
