import path from "node:path";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  AvbaseActorSource,
  AvjohoActorSource,
  GfriendsActorSource,
  LocalActorSource,
  OfficialActorSource,
} from "@mdcz/runtime/actorSource";
import type { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { ServerConfigService } from "./services/configService";

export const serverActorImageCacheRoot = (config: ServerConfigService): string =>
  path.join(config.runtimePaths.dataDir, "actor-image-cache");

export const createServerActorSourceProvider = (
  config: ServerConfigService,
  networkClient: NetworkClient,
  actorImageService?: ActorImageService,
): ActorSourceProvider => {
  const logger = runtimeLoggerService.getLogger("ActorSource");
  const imageService =
    actorImageService ??
    new ActorImageService({
      cacheRoot: serverActorImageCacheRoot(config),
      logger,
      networkClient,
    });

  return new ActorSourceProvider({
    logger,
    registry: new ActorSourceRegistry([
      new LocalActorSource({ actorImageService: imageService }),
      new OfficialActorSource({ networkClient }),
      new GfriendsActorSource({ networkClient }),
      // Headless host: no Electron cookie window. Avjoho still has its session challenge path.
      new AvjohoActorSource({ networkClient }),
      new AvbaseActorSource({ networkClient }),
    ]),
  });
};
