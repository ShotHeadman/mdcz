import path from "node:path";
import type { MediaLibrarySettings } from "@mdcz/shared/mediaLibrary";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value.trim() : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

export interface LegacyConfigurationConversion {
  /** The library the single-directory settings described; absent when no media directory was set. */
  library?: MediaLibrarySettings;
}

/**
 * Single-directory settings (`paths.mediaPath`, `watch`, `behavior.successFile*`, the naming templates) moved into
 * libraries. This is the only code that reads them: it rewrites `raw` in place for the current schema and returns the
 * library they described; the caller saves the configuration back once the library exists.
 */
export const convertLegacyConfiguration = (raw: unknown): LegacyConfigurationConversion | undefined => {
  const document = record(raw);
  const paths = record(document.paths);
  const behavior = record(document.behavior);
  const naming = record(document.naming);
  const watch = record(document.watch);
  const legacy =
    ["mediaPath", "metadataPath", "successOutputFolder"].some((key) => key in paths) ||
    ["metadataOnly", "successFileMove", "successFileRename"].some((key) => key in behavior) ||
    ["folderTemplate", "fileTemplate"].some((key) => key in naming) ||
    "watch" in document;
  if (!legacy) return undefined;

  const mediaPath = text(paths.mediaPath, "");
  const hasMediaPath = Boolean(mediaPath) && path.isAbsolute(mediaPath);
  // A relative actor photo folder resolved against the media directory; without one it cannot be kept.
  const actorPhotoFolder = text(paths.actorPhotoFolder, "");
  if (actorPhotoFolder && !path.isAbsolute(actorPhotoFolder))
    paths.actorPhotoFolder = hasMediaPath ? path.resolve(mediaPath, actorPhotoFolder) : "";
  if (!hasMediaPath) return {};

  const metadataOnly = flag(behavior.metadataOnly, false);
  const move = flag(behavior.successFileMove, true);
  const outputFolder = text(paths.successOutputFolder, "JAV_output");
  return {
    library: {
      name: path.basename(mediaPath) || mediaPath,
      sourcePath: mediaPath,
      outputPath: metadataOnly
        ? text(paths.metadataPath, "")
        : move && outputFolder
          ? path.resolve(mediaPath, outputFolder)
          : "",
      folderTemplate: text(naming.folderTemplate, "{actor}/{number}"),
      fileTemplate: flag(behavior.successFileRename, true) ? text(naming.fileTemplate, "{number}") : "{filename}",
      placement: metadataOnly ? "metadataOnly" : move ? "move" : "inPlace",
      automation: flag(watch.enabled, false) ? "scrape" : "off",
      discovery: "events",
      cloudPath: "",
      scanIntervalMinutes:
        typeof watch.intervalMinutes === "number" ? Math.min(1440, Math.max(1, Math.trunc(watch.intervalMinutes))) : 15,
    },
  };
};
