import type { Configuration } from "@mdcz/shared/config";
import type { RuntimeNetworkClient } from "../network";
import { toErrorMessage } from "../shared";
import { buildMediaServerHeaders, buildMediaServerUrl, type MediaServerKey } from "./client";

/** Servers told of published folders; post-scrape actor syncs run on the same ones, since only they create the people. */
export const notifiedMediaServers = (configuration: Configuration): MediaServerKey[] =>
  (["jellyfin", "emby"] as const).filter((key) => {
    const server = configuration[key];
    return server.notifyAfterPublish && server.url.trim() && server.apiKey.trim();
  });

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
  const body = JSON.stringify({ Updates: directories.map((path) => ({ Path: path, UpdateType: "Created" })) });
  await Promise.all(
    notifiedMediaServers(configuration).map(async (key) => {
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

interface MediaServerFolder {
  Id: string;
  Path?: string;
}

const toComparablePath = (path: string): string => {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  // Windows paths ignore case, and a server may report a library location in another case than MDCz's.
  return /^(?:[a-z]:|\/\/)/iu.test(normalized) ? normalized.toLowerCase() : normalized;
};

/**
 * Asks a server to scan the directories that received movies now, instead of after its library monitor delay
 * (Jellyfin 60s, Emby 90s). Each refresh covers only the nearest folder the server already knows, without recursion,
 * as its own delayed scan would; the server still scans any new folder inside it in full. Staying this narrow matters
 * on NAS and cloud mounts, where every listing is slow or rate limited. The folder is found by walking the server's
 * item tree, which reads no files. Returns how many folders it refreshed; none when no library holds the directories,
 * as when the server sees them under other paths.
 */
export const refreshPublishedFolders = async (
  networkClient: Pick<RuntimeNetworkClient, "getJson" | "postText">,
  configuration: Configuration,
  server: MediaServerKey,
  directories: readonly string[],
): Promise<number> => {
  const headers = buildMediaServerHeaders(configuration, server, { accept: "application/json" });
  const libraries = await networkClient.getJson<Array<{ ItemId?: string; Locations?: string[] }>>(
    buildMediaServerUrl(configuration, server, "/Library/VirtualFolders"),
    { headers },
  );
  const subfolders = new Map<string, Promise<{ Items?: MediaServerFolder[] }>>();
  const folderIds = new Set<string>();
  for (const directory of new Set(directories.map(toComparablePath))) {
    const contains = (folder: string) => {
      const path = toComparablePath(folder);
      return directory === path || directory.startsWith(`${path}/`);
    };
    let folderId = libraries.find((library) => library.Locations?.some(contains))?.ItemId;
    while (folderId) {
      const parentId = folderId;
      if (!subfolders.has(parentId)) {
        const url = buildMediaServerUrl(configuration, server, "/Items", {
          ParentId: parentId,
          IsFolder: "true",
          Fields: "Path",
        });
        subfolders.set(parentId, networkClient.getJson(url, { headers }));
      }
      folderId = (await subfolders.get(parentId))?.Items?.find((item) => item.Path && contains(item.Path))?.Id;
      if (!folderId) folderIds.add(parentId);
    }
  }
  for (const folderId of folderIds) {
    const url = buildMediaServerUrl(configuration, server, `/Items/${folderId}/Refresh`, {
      Recursive: "false",
      MetadataRefreshMode: "Default",
      ImageRefreshMode: "Default",
    });
    await networkClient.postText(url, "", { headers });
  }
  return folderIds.size;
};
