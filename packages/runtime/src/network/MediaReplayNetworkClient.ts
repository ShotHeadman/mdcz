import { runtimeLoggerService } from "../shared";
import { getMediaFixtureContext } from "./crawlerFixtureContext";
import {
  DEFAULT_MOCK_MEDIA_ROOT,
  type LoadedMediaFixture,
  loadMediaFixture,
  loadMockMediaBytes,
  MissingMediaBlobError,
  mediaRequestIdentity,
  mockMediaKindFromContentType,
} from "./mediaFixture";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";
import { ReplayResponse } from "./ReplayResponse";

const mediaReplayLogger = runtimeLoggerService.getLogger("MediaReplayNetworkClient");

export interface MediaReplayNetworkClientOptions {
  caseId?: string;
  manifestRoot: string;
  blobRoot: string;
  mockMediaRoot?: string;
  fallbackToMock?: boolean;
  network?: Omit<NetworkClientOptions, "getRetryCount" | "rawDispatch">;
}

export class MediaReplayNetworkClient extends NetworkClient {
  private readonly states = new Map<string, Promise<{ loaded: LoadedMediaFixture; consumedSequences: Set<number> }>>();
  private readonly mockedHashes = new Set<string>();
  private readonly caseId: string | undefined;
  private readonly manifestRoot: string;
  private readonly blobRoot: string;
  private readonly mockMediaRoot: string;
  private readonly fallbackToMock: boolean;

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
    this.mockMediaRoot = options.mockMediaRoot ?? DEFAULT_MOCK_MEDIA_ROOT;
    this.fallbackToMock = options.fallbackToMock ?? true;
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
    let body = loaded.responseBodies.get(response.sha256);
    if (!body && response.byteLength === 0) body = new Uint8Array();
    if (!body && !this.fallbackToMock) throw new MissingMediaBlobError(loaded.manifest.caseId, response.sha256);
    if (!body) {
      const kind = mockMediaKindFromContentType(
        response.headers.find(([name]) => name === "content-type")?.[1] ?? null,
      );
      if (!this.mockedHashes.has(response.sha256)) {
        this.mockedHashes.add(response.sha256);
        mediaReplayLogger.warn(
          `Media blob ${response.sha256} is not hydrated for ${loaded.manifest.caseId}; using built-in mock ${kind} from ${this.mockMediaRoot}`,
        );
      }
      body = await loadMockMediaBytes(kind, this.mockMediaRoot);
    }
    const headers = new Headers(response.headers);
    if (headers.has("content-length")) headers.set("content-length", String(body.byteLength));
    return new ReplayResponse(response.status, response.statusText, headers, response.url, body);
  }

  private async getState(caseId: string): Promise<{ loaded: LoadedMediaFixture; consumedSequences: Set<number> }> {
    let state = this.states.get(caseId);
    if (!state) {
      state = loadMediaFixture(this.manifestRoot, this.blobRoot, caseId, {
        requireBlobs: !this.fallbackToMock,
      }).then((loaded) => ({
        loaded,
        consumedSequences: new Set<number>(),
      }));
      this.states.set(caseId, state);
    }
    return await state;
  }
}
