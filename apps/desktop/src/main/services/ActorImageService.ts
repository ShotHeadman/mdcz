import { join } from "node:path";
import { ActorImageService as RuntimeActorImageService } from "@mdcz/runtime/scrape";
import type { ActorImageServiceDependencies as RuntimeActorImageServiceDependencies } from "@mdcz/runtime/scrape/ActorImageService";
import { getDesktopUserDataPath } from "../appIdentity";
import { loggerService } from "./LoggerService";

export type ActorImageServiceDependencies = Pick<RuntimeActorImageServiceDependencies, "networkClient">;

export const getActorImageCacheDirectory = (): string => join(getDesktopUserDataPath(), "actor-image-cache");

export class ActorImageService extends RuntimeActorImageService {
  constructor(deps: ActorImageServiceDependencies = {}) {
    super({
      cacheRoot: getActorImageCacheDirectory(),
      logger: loggerService.getLogger("ActorImageService"),
      networkClient: deps.networkClient,
    });
  }
}
