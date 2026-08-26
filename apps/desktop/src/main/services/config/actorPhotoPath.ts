import {
  ActorPhotoFolderConfigurationError,
  type ResolveActorPhotoFolderPathOptions,
  resolveActorPhotoFolderPath,
  usesLocalActorImageSource,
} from "@mdcz/runtime/scrape/actorImage/actorPhotoPath";
import type { Configuration } from "@mdcz/shared/config";

export {
  ActorPhotoFolderConfigurationError,
  type ResolveActorPhotoFolderPathOptions,
  resolveActorPhotoFolderPath,
  usesLocalActorImageSource,
};

export const assertLocalActorImageSourceReady = (configuration: Configuration): void => {
  if (!usesLocalActorImageSource(configuration)) {
    return;
  }

  resolveActorPhotoFolderPath(configuration, { requireBase: true });
};
