import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { PersonSyncResult } from "@mdcz/shared/ipcTypes";
import type { ActorProfile } from "@mdcz/shared/types";
import type { RuntimeNetworkClient } from "../network";

export type MediaServerKey = "emby" | "jellyfin";
export type MediaServerMode = "all" | "missing";

export interface MediaServerPerson {
  id: string;
  name: string;
  overview?: string;
  imageTags?: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface MediaServerProbeResult {
  ok: boolean;
  message: string;
  serverName?: string;
  version?: string;
  personCount?: number;
}

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/u, "");

const getMediaConfig = (configuration: Configuration, server: MediaServerKey) =>
  server === "emby" ? configuration.emby : configuration.jellyfin;

const buildMediaServerUrl = (
  configuration: Configuration,
  server: MediaServerKey,
  path: string,
  query: Record<string, string | undefined> = {},
): string => {
  const mediaConfig = getMediaConfig(configuration, server);
  const baseUrl = normalizeBaseUrl(mediaConfig.url);
  if (!baseUrl) {
    throw new Error(`${server} URL is not configured`);
  }

  const url = new URL(path, `${baseUrl}/`);
  const apiKey = mediaConfig.apiKey.trim();
  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value.trim().length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

const buildMediaServerHeaders = (configuration: Configuration, server: MediaServerKey): Headers => {
  const headers = new Headers();
  const apiKey = getMediaConfig(configuration, server).apiKey.trim();
  if (apiKey) {
    headers.set("X-Emby-Token", apiKey);
    headers.set("X-MediaBrowser-Token", apiKey);
  }
  return headers;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : undefined;

const normalizePersonName = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const indexProfiles = (profiles: ActorProfile[]): Map<string, ActorProfile> => {
  const result = new Map<string, ActorProfile>();
  for (const profile of profiles) {
    for (const candidate of [profile.name, ...(profile.aliases ?? [])]) {
      const key = normalizePersonName(candidate);
      if (key && !result.has(key)) {
        result.set(key, profile);
      }
    }
  }
  return result;
};

const parsePeople = (response: unknown): MediaServerPerson[] => {
  const root = asRecord(response);
  const items = Array.isArray(response) ? response : Array.isArray(root?.Items) ? root.Items : [];
  return items
    .map((item): MediaServerPerson | null => {
      const record = asRecord(item);
      if (!record) return null;
      const id = asString(record.Id);
      const name = asString(record.Name);
      if (!id || !name) return null;
      const imageTags = asRecord(record.ImageTags);
      return {
        id,
        name,
        overview: asString(record.Overview),
        imageTags: imageTags
          ? Object.fromEntries(Object.entries(imageTags).map(([key, value]) => [key, String(value)]))
          : undefined,
        raw: record,
      };
    })
    .filter((person): person is MediaServerPerson => person !== null);
};

const hasPrimaryImage = (person: MediaServerPerson): boolean => Boolean(person.imageTags?.Primary?.trim());

const emptySyncResult = (): PersonSyncResult => ({ failedCount: 0, processedCount: 0, skippedCount: 0 });

export const listMediaServerPeople = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  server: MediaServerKey,
  options: { limit?: number } = {},
): Promise<MediaServerPerson[]> => {
  const path = server === "emby" ? "/Persons" : "/Persons";
  const userId = getMediaConfig(configuration, server).userId.trim();
  const response = await networkClient.getJson<unknown>(
    buildMediaServerUrl(configuration, server, path, {
      Fields: "Overview,ImageTags",
      Limit: options.limit === undefined ? undefined : String(options.limit),
      PersonTypes: server === "emby" ? "Actor,GuestStar" : "Actor",
      personTypes: server === "jellyfin" ? "Actor" : undefined,
      userId: server === "jellyfin" ? userId || undefined : undefined,
      userid: server === "emby" ? userId || undefined : undefined,
    }),
    { headers: buildMediaServerHeaders(configuration, server) },
  );
  return parsePeople(response);
};

export const probeMediaServer = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  server: MediaServerKey,
): Promise<MediaServerProbeResult> => {
  try {
    const mediaConfig = getMediaConfig(configuration, server);
    if (!mediaConfig.url.trim() || !mediaConfig.apiKey.trim()) {
      return { ok: false, message: "未配置服务地址或 API Key" };
    }

    const info = asRecord(
      await networkClient.getJson<unknown>(buildMediaServerUrl(configuration, server, "/System/Info"), {
        timeout: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
        headers: buildMediaServerHeaders(configuration, server),
      }),
    );
    const people = await listMediaServerPeople(networkClient, configuration, server, { limit: 1 }).catch(() => []);
    const serverName = asString(info?.ServerName) ?? asString(info?.LocalAddress);
    const version = asString(info?.Version);
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

const fetchPersonDetail = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  server: MediaServerKey,
  person: MediaServerPerson,
): Promise<Record<string, unknown>> => {
  const userId = getMediaConfig(configuration, server).userId.trim();
  const path = userId
    ? `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(person.id)}`
    : `/Items/${encodeURIComponent(person.id)}`;
  return (
    asRecord(
      await networkClient.getJson<unknown>(buildMediaServerUrl(configuration, server, path), {
        headers: buildMediaServerHeaders(configuration, server),
      }),
    ) ?? person.raw
  );
};

export const syncMediaServerPersonInfo = async (
  networkClient: RuntimeNetworkClient,
  configuration: Configuration,
  server: MediaServerKey,
  profiles: ActorProfile[],
  mode: MediaServerMode,
): Promise<PersonSyncResult> => {
  const result = emptySyncResult();
  const profilesByName = indexProfiles(profiles);
  const people = await listMediaServerPeople(networkClient, configuration, server);
  for (const person of people) {
    const profile = profilesByName.get(normalizePersonName(person.name));
    const overview = profile?.description?.trim();
    if (!profile || !overview) {
      result.skippedCount += 1;
      continue;
    }
    if (mode === "missing" && person.overview?.trim()) {
      result.skippedCount += 1;
      continue;
    }

    try {
      const detail = await fetchPersonDetail(networkClient, configuration, server, person);
      const payload = { ...detail, Id: person.id, Name: asString(detail.Name) ?? person.name, Overview: overview };
      await networkClient.postJsonDetailed?.(
        buildMediaServerUrl(configuration, server, `/Items/${encodeURIComponent(person.id)}`),
        payload,
        { headers: buildMediaServerHeaders(configuration, server) },
      );
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
  configuration: Configuration,
  server: MediaServerKey,
  profiles: ActorProfile[],
  mode: MediaServerMode,
): Promise<PersonSyncResult> => {
  const result = emptySyncResult();
  const networkClient = {
    getJson: async <T>(url: string, init?: RequestInit) => (await (await fetch(url, init)).json()) as T,
  };
  const peopleResponse = await networkClient.getJson<unknown>(
    buildMediaServerUrl(configuration, server, "/Persons", {
      Fields: "Overview,ImageTags",
      PersonTypes: server === "emby" ? "Actor,GuestStar" : "Actor",
    }),
    { headers: buildMediaServerHeaders(configuration, server) },
  );
  const profilesByName = indexProfiles(profiles);
  for (const person of parsePeople(peopleResponse)) {
    const profile = profilesByName.get(normalizePersonName(person.name));
    const photoUrl = profile?.photo_url?.trim();
    if (!profile || !photoUrl || !/^https?:\/\//iu.test(photoUrl)) {
      result.skippedCount += 1;
      continue;
    }
    if (mode === "missing" && hasPrimaryImage(person)) {
      result.skippedCount += 1;
      continue;
    }

    try {
      const imageResponse = await fetch(photoUrl);
      if (!imageResponse.ok) {
        throw new Error(`HTTP ${imageResponse.status} for ${photoUrl}`);
      }
      const uploadHeaders = buildMediaServerHeaders(configuration, server);
      uploadHeaders.set("content-type", imageResponse.headers.get("content-type") ?? contentTypeFromUrl(photoUrl));
      const uploadResponse = await fetch(
        buildMediaServerUrl(configuration, server, `/Items/${encodeURIComponent(person.id)}/Images/Primary`),
        { body: await imageResponse.arrayBuffer(), headers: uploadHeaders, method: "POST" },
      );
      if (!uploadResponse.ok) {
        throw new Error(`HTTP ${uploadResponse.status} ${uploadResponse.statusText}`);
      }
      result.processedCount += 1;
    } catch {
      result.failedCount += 1;
    }
  }
  return result;
};
