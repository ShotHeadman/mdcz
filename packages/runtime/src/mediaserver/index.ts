import type { RuntimeNetworkClient } from "../network";
import { toErrorMessage } from "../shared";
import { buildMediaServerHeaders, buildMediaServerUrl, type MediaServerKey } from "./client";
import { toStringValue } from "./common";
import { fetchEmbyActorPersons } from "./emby";
import { fetchJellyfinPersons } from "./jellyfin";
import type { MediaServerPerson, MediaServerProbeResult } from "./types";

export * from "./client";
export * from "./common";
export * from "./connectionCheck";
export * from "./emby";
export * from "./errors";
export * from "./infoSync";
export * from "./jellyfin";
export * from "./personSync";
export * from "./photoSync";
export * from "./planner";
export * from "./types";

export const listMediaServerPeople = async (
  networkClient: RuntimeNetworkClient,
  configuration: import("@mdcz/shared/config").Configuration,
  server: MediaServerKey,
  options: { limit?: number } = {},
): Promise<MediaServerPerson[]> => {
  const people =
    server === "emby"
      ? await fetchEmbyActorPersons(networkClient, configuration, {
          fields: ["Overview", "ImageTags"],
          limit: options.limit,
        })
      : await fetchJellyfinPersons(networkClient, configuration, {
          fields: ["Overview", "ImageTags"],
          limit: options.limit,
        });
  return people.map((person) => ({
    id: person.Id,
    name: person.Name,
    overview: person.Overview,
    imageTags: person.ImageTags,
    raw: person,
  }));
};

export const probeMediaServer = async (
  networkClient: RuntimeNetworkClient,
  configuration: import("@mdcz/shared/config").Configuration,
  server: MediaServerKey,
): Promise<MediaServerProbeResult> => {
  try {
    const mediaConfig = server === "emby" ? configuration.emby : configuration.jellyfin;
    if (!mediaConfig.url.trim() || !mediaConfig.apiKey.trim()) {
      return { ok: false, message: "未配置服务地址或 API Key" };
    }

    const info = await networkClient.getJson<Record<string, unknown>>(
      buildMediaServerUrl(configuration, server, "/System/Info"),
      {
        timeout: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
        headers: buildMediaServerHeaders(configuration, server),
      },
    );
    const people = await listMediaServerPeople(networkClient, configuration, server, { limit: 1 }).catch(() => []);
    const serverName = toStringValue(info.ServerName) ?? toStringValue(info.LocalAddress);
    const version = toStringValue(info.Version);
    return {
      ok: true,
      message: serverName ? `${serverName}${version ? ` ${version}` : ""}` : "媒体服务器响应正常",
      serverName,
      version,
      personCount: people.length,
    };
  } catch (error) {
    return { ok: false, message: toErrorMessage(error) };
  }
};
