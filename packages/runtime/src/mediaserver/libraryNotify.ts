import type { Configuration } from "@mdcz/shared/config";
import type { RuntimeNetworkClient } from "../network";
import { toErrorMessage } from "../shared";
import { buildMediaServerHeaders, buildMediaServerUrl, type MediaServerKey } from "./client";

/**
 * Tells Emby and Jellyfin that directories received movies, so each scans just those paths instead of waiting for a
 * scheduled library scan. Both servers accept this endpoint; a path outside their libraries is ignored.
 */
export const notifyMediaServersOfPublish = async (
  networkClient: Pick<RuntimeNetworkClient, "postText">,
  configuration: Configuration,
  directories: readonly string[],
  logger: { warn(message: string): void },
): Promise<void> => {
  if (!directories.length) return;
  const servers: MediaServerKey[] = (["emby", "jellyfin"] as const).filter((key) => {
    const server = configuration[key];
    return server.notifyAfterPublish && server.url.trim() && server.apiKey.trim();
  });
  const body = JSON.stringify({ Updates: directories.map((path) => ({ Path: path, UpdateType: "Created" })) });
  await Promise.all(
    servers.map(async (key) => {
      try {
        await networkClient.postText(buildMediaServerUrl(configuration, key, "/Library/Media/Updated"), body, {
          headers: buildMediaServerHeaders(configuration, key, { "content-type": "application/json" }),
        });
      } catch (error) {
        logger.warn(`Could not ask ${key} to scan ${directories.join(", ")}: ${toErrorMessage(error)}`);
      }
    }),
  );
};
