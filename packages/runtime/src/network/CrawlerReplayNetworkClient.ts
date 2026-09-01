import type { Website } from "@mdcz/shared/enums";
import {
  headersToCassetteList,
  type LoadedCrawlerCassette,
  loadCrawlerCassette,
  rawRequestBodyToBase64,
} from "./crawlerCassette";
import { getCrawlerFixtureContext } from "./crawlerFixtureContext";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";

interface ReplayState {
  loaded: LoadedCrawlerCassette;
  consumedSequences: Set<number>;
}

export interface CrawlerReplayNetworkClientOptions {
  fixturesRoot: string;
  network?: Omit<NetworkClientOptions, "getRetryCount" | "rawDispatch">;
}

class ReplayResponse implements RawNetworkResponse {
  readonly ok: boolean;
  readonly body: ReadableStream<Uint8Array> | null;
  private readonly response: Response;

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly headers: Headers,
    readonly url: string,
    bytes: Uint8Array,
  ) {
    this.ok = status >= 200 && status < 300;
    const nullBody = status === 101 || status === 204 || status === 205 || status === 304;
    this.response = new Response(nullBody ? null : Uint8Array.from(bytes).buffer, { status, statusText, headers });
    this.body = this.response.body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return await this.response.arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  async text(): Promise<string> {
    return await this.response.text();
  }

  async json(): Promise<unknown> {
    return await this.response.json();
  }

  clone(): Response {
    return this.response.clone();
  }

  abort(): void {}
}

const replayKey = (website: Website, caseId: string): string => `${website}\u0000${caseId}`;

export class CrawlerReplayNetworkClient extends NetworkClient {
  private readonly fixturesRoot: string;
  private readonly states = new Map<string, Promise<ReplayState>>();

  constructor(options: CrawlerReplayNetworkClientOptions) {
    super({
      ...options.network,
      getRetryCount: () => 0,
      rawDispatch: async (request) => await this.dispatchFixture(request),
    });
    this.fixturesRoot = options.fixturesRoot;
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
  }

  private async dispatchFixture(request: RawNetworkRequest): Promise<RawNetworkResponse> {
    const context = getCrawlerFixtureContext();
    if (!context) {
      throw new Error(
        "Crawler replay requires active item and Website contexts with a caseId; public network fallback is disabled",
      );
    }

    const { website } = context.source;
    const { caseId } = context.item;
    const state = await this.getState(website, caseId);
    const method = (request.init.method ?? "GET").toUpperCase();
    const headers = headersToCassetteList(request.init.headers);
    const bodyBase64 = await rawRequestBodyToBase64(request.init.body);
    const interaction = state.loaded.cassette.interactions.find(
      (candidate) =>
        !state.consumedSequences.has(candidate.sequence) &&
        candidate.request.method.toUpperCase() === method &&
        candidate.request.url === request.url &&
        candidate.request.bodyBase64 === bodyBase64 &&
        JSON.stringify(candidate.request.headers) === JSON.stringify(headers),
    );

    if (!interaction) {
      const remaining = state.loaded.cassette.interactions
        .filter((candidate) => !state.consumedSequences.has(candidate.sequence))
        .map((candidate) => `#${candidate.sequence} ${candidate.request.method} ${candidate.request.url}`)
        .join(", ");
      throw new Error(
        `Missing crawler fixture interaction for ${website}/${caseId}: ${method} ${request.url}; remaining: ${remaining || "none"}`,
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
