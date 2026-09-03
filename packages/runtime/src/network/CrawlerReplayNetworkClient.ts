import type { Website } from "@mdcz/shared/enums";
import {
  type CrawlerCredentialSeed,
  headersToCassetteList,
  type LoadedCrawlerCassette,
  loadCrawlerCassette,
  rawRequestBodyToBase64,
} from "./crawlerCassette";
import { getCrawlerFixtureContext, getMediaFixtureContext } from "./crawlerFixtureContext";
import { MediaReplayNetworkClient } from "./MediaReplayNetworkClient";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";
import { ReplayResponse } from "./ReplayResponse";

interface ReplayState {
  loaded: LoadedCrawlerCassette;
  consumedSequences: Set<number>;
}

export interface CrawlerReplayNetworkClientOptions {
  fixturesRoot: string;
  media?: { manifestRoot: string; blobRoot: string };
  network?: Omit<NetworkClientOptions, "getRetryCount" | "rawDispatch">;
}

const replayKey = (website: Website, caseId: string): string => `${website}\u0000${caseId}`;

const seedReplayRequest = (
  request: RawNetworkRequest,
  encodedBody: string | null,
  seed: CrawlerCredentialSeed,
  expectedHeaders: Array<[string, string]>,
) => {
  const url = new URL(request.url);
  for (const [name, value] of Object.entries(seed.tokens)) {
    if (url.searchParams.has(name)) url.searchParams.set(name, value);
  }

  const headers = new Headers(request.init.headers);
  const expected = new Headers(expectedHeaders);
  const expectedCookieNames = new Set(
    (expected.get("cookie")?.split(";") ?? []).map((part) => part.slice(0, part.indexOf("=")).trim()).filter(Boolean),
  );
  if (expectedCookieNames.size > 0) {
    const cookies = new Map<string, string>();
    for (const part of headers.get("cookie")?.split(";") ?? []) {
      const separator = part.indexOf("=");
      if (separator > 0) cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
    }
    for (const [name, value] of Object.entries(seed.cookies)) {
      if (expectedCookieNames.has(name)) cookies.set(name, value);
    }
    headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  }
  const authorization = expected.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  const csrf = seed.tokens.csrf;
  if (csrf) {
    if (expected.has("x-xsrf-token")) headers.set("x-xsrf-token", csrf);
    if (expected.has("x-csrf-token")) headers.set("x-csrf-token", csrf);
  }

  let body = encodedBody ? Buffer.from(encodedBody, "base64").toString("utf8") : null;
  if (body) {
    const replacements = { ...seed.cookies, ...seed.tokens };
    const contentType = headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
      try {
        const replace = (value: unknown, key = ""): unknown => {
          if (typeof value === "string") return replacements[key] ?? value;
          if (Array.isArray(value)) return value.map((item) => replace(item, key));
          if (value && typeof value === "object") {
            return Object.fromEntries(
              Object.entries(value).map(([childKey, child]) => [childKey, replace(child, childKey)]),
            );
          }
          return value;
        };
        body = JSON.stringify(replace(JSON.parse(body)));
      } catch {}
    } else {
      const form = new URLSearchParams(body);
      for (const [name, value] of Object.entries(replacements)) {
        if (form.has(name)) form.set(name, value);
      }
      body = form.toString();
    }
    if (headers.has("content-length")) headers.set("content-length", String(Buffer.byteLength(body)));
  }

  return {
    method: (request.init.method ?? "GET").toUpperCase(),
    url: url.toString(),
    headers: headersToCassetteList(headers),
    bodyBase64: body === null ? null : Buffer.from(body).toString("base64"),
  };
};

export class CrawlerReplayNetworkClient extends NetworkClient {
  private readonly fixturesRoot: string;
  private readonly states = new Map<string, Promise<ReplayState>>();
  private readonly mediaReplay: MediaReplayNetworkClient | undefined;

  constructor(options: CrawlerReplayNetworkClientOptions) {
    super({
      ...options.network,
      getRetryCount: () => 0,
      rawDispatch: async (request) => await this.dispatchFixture(request),
    });
    this.fixturesRoot = options.fixturesRoot;
    this.mediaReplay = options.media ? new MediaReplayNetworkClient(options.media) : undefined;
  }

  async getCredentialSeed(caseId: string, website: Website) {
    return (await this.getState(website, caseId)).loaded.cassette.credentialSeed;
  }

  async assertConsumed(selection?: { caseId: string; websites: readonly Website[] }): Promise<void> {
    const states = selection
      ? await Promise.all(selection.websites.map(async (website) => await this.getState(website, selection.caseId)))
      : await Promise.all(this.states.values());
    const residual: string[] = [];

    for (const state of states) {
      for (const interaction of state.loaded.cassette.interactions) {
        if (!state.consumedSequences.has(interaction.sequence)) {
          residual.push(
            `${state.loaded.cassette.website}/${state.loaded.cassette.caseId} #${interaction.sequence} ${interaction.request.method} ${interaction.request.url}`,
          );
        }
      }
    }

    if (residual.length > 0) {
      throw new Error(`Crawler replay left unconsumed interactions:\n${residual.join("\n")}`);
    }
    await this.mediaReplay?.assertConsumed(selection?.caseId);
  }

  private async dispatchFixture(request: RawNetworkRequest): Promise<RawNetworkResponse> {
    const context = getCrawlerFixtureContext();
    if (!context) {
      const mediaContext = getMediaFixtureContext();
      if (mediaContext && this.mediaReplay) return await this.mediaReplay.dispatchForCase(request, mediaContext.caseId);
      throw new Error(
        "Crawler replay requires active item and Website contexts with a caseId; public network fallback is disabled",
      );
    }

    const { website } = context.source;
    const { caseId } = context.item;
    const state = await this.getState(website, caseId);
    const encodedBody = await rawRequestBodyToBase64(request.init.body);
    let seeded = seedReplayRequest(request, encodedBody, state.loaded.cassette.credentialSeed, []);
    const interaction = state.loaded.cassette.interactions.find((candidate) => {
      if (state.consumedSequences.has(candidate.sequence)) return false;
      seeded = seedReplayRequest(request, encodedBody, state.loaded.cassette.credentialSeed, candidate.request.headers);
      return (
        candidate.request.method.toUpperCase() === seeded.method &&
        candidate.request.url === seeded.url &&
        candidate.request.bodyBase64 === seeded.bodyBase64 &&
        JSON.stringify(candidate.request.headers) === JSON.stringify(seeded.headers)
      );
    });

    if (!interaction) {
      const remaining = state.loaded.cassette.interactions
        .filter((candidate) => !state.consumedSequences.has(candidate.sequence))
        .map((candidate) => `#${candidate.sequence} ${candidate.request.method} ${candidate.request.url}`)
        .join(", ");
      throw new Error(
        `Missing crawler fixture interaction for ${website}/${caseId}: ${seeded.method} ${seeded.url}; remaining: ${remaining || "none"}`,
      );
    }

    state.consumedSequences.add(interaction.sequence);
    if (interaction.transportError) {
      const error = new Error(interaction.transportError.message);
      error.name = interaction.transportError.name;
      throw error;
    }

    const response = interaction.response;
    if (!response) throw new Error(`Crawler cassette interaction ${interaction.sequence} has no outcome`);
    const body = state.loaded.responseBodies.get(interaction.sequence);
    if (!body) throw new Error(`Crawler cassette response body is missing for interaction ${interaction.sequence}`);
    return new ReplayResponse(response.status, response.statusText, new Headers(response.headers), response.url, body);
  }

  private async getState(website: Website, caseId: string): Promise<ReplayState> {
    const key = replayKey(website, caseId);
    let state = this.states.get(key);
    if (!state) {
      state = loadCrawlerCassette(this.fixturesRoot, website, caseId).then((loaded) => ({
        loaded,
        consumedSequences: new Set<number>(),
      }));
      this.states.set(key, state);
    }
    return await state;
  }
}
