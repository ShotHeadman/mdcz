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
import type { CookieResolver, NetworkClient } from "@mdcz/runtime/network";
import type { ActorImageService } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { ServerConfigService } from "./services/configService";

export const serverActorImageCacheRoot = (config: ServerConfigService): string =>
  path.join(config.runtimePaths.dataDir, "actor-image-cache");

export const createServerActorSourceProvider = (
  networkClient: NetworkClient,
  actorImageService: ActorImageService,
  listLibraryDirectories?: () => Promise<string[]>,
  avjohoCookieResolver?: CookieResolver,
): ActorSourceProvider =>
  new ActorSourceProvider({
    logger: runtimeLoggerService.getLogger("ActorSource"),
    registry: new ActorSourceRegistry([
      new LocalActorSource({ actorImageService, listLibraryDirectories }),
      new OfficialActorSource({ networkClient }),
      new GfriendsActorSource({ networkClient }),
      // Only desktop can pass Avjoho's browser check in a hidden window; elsewhere its session challenge path runs.
      new AvjohoActorSource({ networkClient, cookieResolver: avjohoCookieResolver }),
      new AvbaseActorSource({ networkClient }),
    ]),
  });
