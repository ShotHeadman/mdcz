import path from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { createMediaRoot, type MediaRoot } from "@mdcz/storage";

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

export const createDesktopOutputRoot = (configuration: Configuration, now = new Date()): MediaRoot | null => {
  const hostPath = resolveDesktopOutputRootPath(configuration);
  if (!hostPath) {
    return null;
  }

  return createMediaRoot({
    id: DESKTOP_OUTPUT_ROOT_ID,
    displayName: DESKTOP_OUTPUT_ROOT_DISPLAY_NAME,
    hostPath,
    enabled: true,
    now,
  });
};
