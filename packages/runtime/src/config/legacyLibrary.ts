import path from "node:path";
import { ASSET_NAMING_MODES, NFO_NAMING_MODES } from "@mdcz/shared/assetNaming";
import type { MediaLibrarySettings } from "@mdcz/shared/mediaLibrary";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value.trim() : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const option = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export type LibraryNaming = Pick<MediaLibrarySettings, "assetNaming" | "nfoNaming">;

export interface LegacyConfigurationConversion {
  /** The library the single-directory settings described; absent when no media directory was set. */
  library?: MediaLibrarySettings;
  /** The naming every existing library takes over from a configuration that held it. */
  naming?: LibraryNaming;
}

/** 0.19 kept one media directory and its organizing rules in the configuration; 0.20 moved them into libraries. */
const isSingleDirectoryConfiguration = (document: Record<string, unknown>): boolean => {
  const paths = record(document.paths);
  const behavior = record(document.behavior);
  const naming = record(document.naming);
  return (
    ["mediaPath", "metadataPath", "successOutputFolder"].some((key) => key in paths) ||
    ["metadataOnly", "successFileMove", "successFileRename"].some((key) => key in behavior) ||
    ["folderTemplate", "fileTemplate"].some((key) => key in naming) ||
    "watch" in document
  );
};

/** Asset and NFO naming were global until 0.21; they belong to each library now. */
const readLibraryNaming = (document: Record<string, unknown>): LibraryNaming | undefined => {
  const naming = record(document.naming);
  const download = record(document.download);
  if (!("assetNamingMode" in naming) && !("nfoNaming" in download)) return undefined;
  return {
    assetNaming: option(naming.assetNamingMode, ASSET_NAMING_MODES, "fixed"),
    nfoNaming: option(download.nfoNaming, NFO_NAMING_MODES, "both"),
  };
};

/**
 * Settings that moved into libraries. This is the only code that reads them: it rewrites `raw` in place for the
 * current schema and returns what they described; the caller saves the configuration back once libraries hold it.
 * A configuration converts in one step whichever release wrote it, so the conversion stays for good.
 */
export const convertLegacyConfiguration = (raw: unknown): LegacyConfigurationConversion | undefined => {
  const document = record(raw);
  const naming = readLibraryNaming(document);
  if (!isSingleDirectoryConfiguration(document)) return naming && { naming };

  const paths = record(document.paths);
  const behavior = record(document.behavior);
  const templates = record(document.naming);
  const watch = record(document.watch);
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
      folderTemplate: text(templates.folderTemplate, "{actor}/{number}"),
      fileTemplate: flag(behavior.successFileRename, true) ? text(templates.fileTemplate, "{number}") : "{filename}",
      placement: metadataOnly ? "metadataOnly" : move ? "move" : "inPlace",
      assetNaming: naming?.assetNaming ?? "fixed",
      nfoNaming: naming?.nfoNaming ?? "both",
      automation: flag(watch.enabled, false) ? "scrape" : "off",
      discovery: "events",
      cloudPath: "",
      scanIntervalMinutes:
        typeof watch.intervalMinutes === "number" ? Math.min(1440, Math.max(1, Math.trunc(watch.intervalMinutes))) : 15,
    },
  };
};

/**
 * Drops the naming keys from a profile that is not active. Its libraries already took the active profile's naming, so
 * switching to it later must not copy its own over them. A 0.19 profile stays whole: it still describes a library,
 * which it becomes when it is next loaded as the active profile.
 */
export const removeLibraryNaming = (raw: unknown): boolean => {
  const document = record(raw);
  if (isSingleDirectoryConfiguration(document) || !readLibraryNaming(document)) return false;
  delete record(document.naming).assetNamingMode;
  delete record(document.download).nfoNaming;
  return true;
};
