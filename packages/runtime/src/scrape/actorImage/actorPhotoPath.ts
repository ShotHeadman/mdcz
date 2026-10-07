import type { Configuration } from "@mdcz/shared/config";

export const usesLocalActorImageSource = (configuration: Configuration): boolean =>
  configuration.personSync.personImageSources.includes("local");

/** The configured actor photo folder; the configuration schema requires it absolute. */
export const resolveActorPhotoFolderPath = (configuration: Configuration): string | undefined =>
  configuration.paths.actorPhotoFolder.trim() || undefined;
