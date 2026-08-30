import path from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";

export const DESKTOP_OUTPUT_ROOT_ID = "desktop-output";
export const DESKTOP_OUTPUT_ROOT_DISPLAY_NAME = "桌面输出目录";

export const resolveDesktopOutputRootPath = (configuration: Configuration): string | null => {
  const explicitPath = configuration.paths.outputSummaryPath.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const mediaRoot = configuration.paths.mediaPath.trim();
  const successFolder = configuration.paths.successOutputFolder.trim();
  if (!mediaRoot || !successFolder) {
    return null;
  }

  return path.resolve(mediaRoot, successFolder);
};

export const createDesktopOutputRoot = async (
  mediaRoots: { ensurePath: (hostPath: string, displayName?: string) => Promise<MediaRoot> },
  configuration: Configuration,
): Promise<MediaRoot | null> => {
  const hostPath = resolveDesktopOutputRootPath(configuration);
  if (!hostPath) {
    return null;
  }

  return await mediaRoots.ensurePath(hostPath, DESKTOP_OUTPUT_ROOT_DISPLAY_NAME);
};
