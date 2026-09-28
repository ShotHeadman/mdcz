import { isAbsolute, join } from "node:path";
import type { Configuration } from "@mdcz/shared/config";

export class ActorPhotoFolderConfigurationError extends Error {
  readonly code = "CONFIG_VALIDATION_ERROR";

  constructor() {
    super(
      "When paths.actorPhotoFolder uses a relative path, paths.mediaPath must be configured first, or use an absolute path",
    );
  }
}

export const usesLocalActorImageSource = (configuration: Configuration): boolean =>
  configuration.personSync.personImageSources.includes("local");

export type ResolveActorPhotoFolderPathOptions = {
  fallbackBaseDir?: string;
  requireBase?: boolean;
};

export const resolveActorPhotoFolderPath = (
  configuration: Configuration,
  options: ResolveActorPhotoFolderPathOptions = {},
): string | undefined => {
  const actorPhotoFolder = configuration.paths.actorPhotoFolder.trim();
  if (!actorPhotoFolder) {
    return undefined;
  }

  if (isAbsolute(actorPhotoFolder)) {
    return actorPhotoFolder;
  }

  const mediaPath = configuration.paths.mediaPath.trim();
  if (!mediaPath) {
    const fallbackBaseDir = options.fallbackBaseDir?.trim();
    if (fallbackBaseDir) {
      return join(fallbackBaseDir, actorPhotoFolder);
    }
    if (options.requireBase) {
      throw new ActorPhotoFolderConfigurationError();
    }
    return undefined;
  }

  return join(mediaPath, actorPhotoFolder);
};
