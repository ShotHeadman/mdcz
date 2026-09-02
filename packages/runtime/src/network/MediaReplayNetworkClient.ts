import { getMediaFixtureContext } from "./crawlerFixtureContext";
import { type LoadedMediaFixture, loadMediaFixture, mediaRequestIdentity } from "./mediaFixture";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";
import { ReplayResponse } from "./ReplayResponse";

export interface MediaReplayNetworkClientOptions {
  caseId?: string;
  manifestRoot: string;
  blobRoot: string;
  network?: Omit<NetworkClientOptions, "getRetryCount" | "rawDispatch">;
}

export class MediaReplayNetworkClient extends NetworkClient {
  private readonly states = new Map<string, Promise<{ loaded: LoadedMediaFixture; consumedSequences: Set<number> }>>();
  private readonly caseId: string | undefined;
  private readonly manifestRoot: string;
  private readonly blobRoot: string;

  constructor(options: MediaReplayNetworkClientOptions) {
    super({
      ...options.network,
      getRetryCount: () => 0,
      rawDispatch: async (request) => {
        const caseId = this.caseId ?? getMediaFixtureContext()?.caseId;
        if (!caseId) throw new Error("Media replay requires an explicit caseId or an active media fixture context");
        return await this.dispatchForCase(request, caseId);
      },
    });
    this.caseId = options.caseId;
    this.manifestRoot = options.manifestRoot;
    this.blobRoot = options.blobRoot;
  }

  async assertConsumed(caseId = this.caseId): Promise<void> {
    const states = caseId ? [await this.getState(caseId)] : await Promise.all(this.states.values());
    const residual = states.flatMap(({ loaded, consumedSequences }) =>
      loaded.manifest.interactions
        .filter((interaction) => !consumedSequences.has(interaction.sequence))
        .map(
          (interaction) =>
            `${loaded.manifest.caseId} #${interaction.sequence} ${interaction.request.method} ${interaction.request.url}`,
        ),
    );
    if (residual.length > 0) {
      throw new Error(`Media replay left unconsumed interactions:\n${residual.join("\n")}`);
    }
  }

  async dispatchForCase(request: RawNetworkRequest, caseId: string): Promise<RawNetworkResponse> {
    const { loaded, consumedSequences } = await this.getState(caseId);
    const identity = await mediaRequestIdentity(request);
    const interaction = loaded.manifest.interactions.find(
      (candidate) =>
        !consumedSequences.has(candidate.sequence) &&
        candidate.request.method === identity.method &&
        candidate.request.url === identity.url &&
        candidate.request.bodyBase64 === identity.bodyBase64 &&
        JSON.stringify(candidate.request.headers) === JSON.stringify(identity.headers),
    );
    if (!interaction) {
      throw new Error(
        `Missing media fixture interaction for ${loaded.manifest.caseId}: ${identity.method} ${identity.url}; public network fallback is disabled`,
      );
    }

    consumedSequences.add(interaction.sequence);
    if (interaction.transportError) {
      const error = new Error(interaction.transportError.message);
      error.name = interaction.transportError.name;
      throw error;
    }
    const response = interaction.response;
    if (!response) throw new Error(`Media fixture interaction ${interaction.sequence} has no outcome`);
    const body = loaded.responseBodies.get(response.sha256);
    if (!body) throw new Error(`Media fixture blob is missing for interaction ${interaction.sequence}`);
    return new ReplayResponse(response.status, response.statusText, new Headers(response.headers), response.url, body);
  }

  private async getState(caseId: string): Promise<{ loaded: LoadedMediaFixture; consumedSequences: Set<number> }> {
    let state = this.states.get(caseId);
    if (!state) {
      state = loadMediaFixture(this.manifestRoot, this.blobRoot, caseId).then((loaded) => ({
        loaded,
        consumedSequences: new Set<number>(),
      }));
      this.states.set(caseId, state);
    }
    return await state;
  }
}
