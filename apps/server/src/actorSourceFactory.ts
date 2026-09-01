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
import type { ActorImageService } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { ServerConfigService } from "./services/configService";

export const serverActorImageCacheRoot = (config: ServerConfigService): string =>
  path.join(config.runtimePaths.dataDir, "actor-image-cache");

export const createServerActorSourceProvider = (
  networkClient: NetworkClient,
  actorImageService: ActorImageService,
): ActorSourceProvider =>
  new ActorSourceProvider({
    logger: runtimeLoggerService.getLogger("ActorSource"),
    registry: new ActorSourceRegistry([
      new LocalActorSource({ actorImageService }),
      new OfficialActorSource({ networkClient }),
      new GfriendsActorSource({ networkClient }),
      // Headless host: no Electron cookie window. Avjoho still has its session challenge path.
      new AvjohoActorSource({ networkClient }),
      new AvbaseActorSource({ networkClient }),
    ]),
  });
