import type { ActorProfile } from "@mdcz/shared/types";
import type { RuntimeNetworkClient } from "../network";
import { toErrorMessage } from "../shared";
import { buildMediaServerHeaders, buildMediaServerUrl, type MediaServerKey, type MediaServerMode } from "./client";
import { normalizeMediaServerPersonName, toStringArray, toStringValue } from "./common";
import {
  fetchEmbyActorPersons,
  fetchEmbyPersonDetail,
  hasEmbyPrimaryImage,
  resolveEmbyUserId,
  updateEmbyPersonInfo,
  uploadEmbyPrimaryImage,
} from "./emby";
import {
  fetchJellyfinPersonDetail,
  fetchJellyfinPersons,
  hasJellyfinPrimaryImage,
  resolveJellyfinUserId,
  updateJellyfinPersonInfo,
  uploadJellyfinPrimaryImage,
} from "./jellyfin";
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

const indexProfiles = (profiles: ActorProfile[]): Map<string, ActorProfile> => {
  const result = new Map<string, ActorProfile>();
  for (const profile of profiles) {
    for (const candidate of [profile.name, ...(profile.aliases ?? [])]) {
      const key = normalizeMediaServerPersonName(candidate);
      if (key && !result.has(key)) {
        result.set(key, profile);
      }
    }
  }
  return result;
};

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

export const syncMediaServerPersonInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: import("@mdcz/shared/config").Configuration,
  server: MediaServerKey,
  profiles: ActorProfile[],
  mode: MediaServerMode,
): Promise<import("@mdcz/shared/ipcTypes").PersonSyncResult> => {
  const result = { failedCount: 0, processedCount: 0, skippedCount: 0 };
  const profilesByName = indexProfiles(profiles);
  const people =
    server === "emby"
      ? await fetchEmbyActorPersons(networkClient, configuration, { fields: ["Overview"] })
      : await fetchJellyfinPersons(networkClient, configuration, { fields: ["Overview"] });
  const embyUserId = server === "emby" ? await resolveEmbyUserId(networkClient, configuration) : undefined;
  const jellyfinUserId = server === "jellyfin" ? await resolveJellyfinUserId(networkClient, configuration) : undefined;
  for (const person of people) {
    const profile = profilesByName.get(normalizeMediaServerPersonName(person.Name));
    const overview = profile?.description?.trim();
    if (!profile || !overview) {
      result.skippedCount += 1;
      continue;
    }
    if (mode === "missing" && person.Overview?.trim()) {
      result.skippedCount += 1;
      continue;
    }

    try {
      const detail =
        server === "emby"
          ? await fetchEmbyPersonDetail(networkClient, configuration, person, embyUserId ?? "")
          : await fetchJellyfinPersonDetail(networkClient, configuration, person, { userId: jellyfinUserId });
      const synced = {
        shouldUpdate: true,
        updatedFields: ["overview" as const],
        overview,
        tags: toStringArray(detail.Tags),
        taglines: toStringArray(detail.Taglines),
        productionLocations: toStringArray(detail.ProductionLocations),
      };
      if (server === "emby") {
        await updateEmbyPersonInfo(networkClient, configuration, person, detail, synced);
      } else {
        await updateJellyfinPersonInfo(networkClient, configuration, person, detail, synced, {
          lockOverview: configuration.jellyfin.lockOverviewAfterSync,
        });
      }
      result.processedCount += 1;
    } catch {
      result.failedCount += 1;
    }
  }
  return result;
};

const contentTypeFromUrl = (url: string): string => {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  return "image/jpeg";
};

export const syncMediaServerPersonPhotos = async (
  networkClient: RuntimeNetworkClient,
  configuration: import("@mdcz/shared/config").Configuration,
  server: MediaServerKey,
  profiles: ActorProfile[],
  mode: MediaServerMode,
): Promise<import("@mdcz/shared/ipcTypes").PersonSyncResult> => {
  const result = { failedCount: 0, processedCount: 0, skippedCount: 0 };
  const profilesByName = indexProfiles(profiles);
  const people =
    server === "emby"
      ? await fetchEmbyActorPersons(networkClient, configuration)
      : await fetchJellyfinPersons(networkClient, configuration);
  for (const person of people) {
    const profile = profilesByName.get(normalizeMediaServerPersonName(person.Name));
    const photoUrl = profile?.photo_url?.trim();
    if (!profile || !photoUrl || !/^https?:\/\//iu.test(photoUrl)) {
      result.skippedCount += 1;
      continue;
    }
    if (mode === "missing" && (server === "emby" ? hasEmbyPrimaryImage(person) : hasJellyfinPrimaryImage(person))) {
      result.skippedCount += 1;
      continue;
    }

    try {
      const content = await networkClient.getContent?.(photoUrl, { headers: { accept: "image/*" } });
      if (!content) {
        throw new Error(`Unable to load image ${photoUrl}`);
      }
      const contentType = contentTypeFromUrl(photoUrl);
      if (server === "emby") {
        await uploadEmbyPrimaryImage(networkClient, configuration, person.Id, content, contentType);
      } else {
        await uploadJellyfinPrimaryImage(networkClient, configuration, person.Id, content, contentType);
      }
      result.processedCount += 1;
    } catch {
      result.failedCount += 1;
    }
  }
  return result;
};
