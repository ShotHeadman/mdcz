import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import type { Website } from "@mdcz/shared/enums";
import { type FailureReason, MOVIE_FACT_FAILURE_REASONS, type SiteResult } from "@mdcz/shared/siteResults";
import sharp from "sharp";
import { parseImageDimensions } from "../scrape/utils/image";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";
import { NetworkCredentialRedactor } from "./networkCredentials";
import {
  getNetworkRequestExecutionContext,
  type NetworkRequestExecutionContext,
  observeScrapeItems,
  type ScrapeItemExecutionContext,
  type ScrapeItemObserver,
} from "./networkExecution";
import {
  headersToFixtureList,
  loadNetworkFixture,
  type NetworkFixtureCredentialSeed,
  type NetworkFixtureInteraction,
  type NetworkFixtureManifest,
  type NetworkFixtureRequest,
  networkRequestIdentity,
  normalizeFixtureUrl,
  rawRequestBodyToBase64,
  resolveNetworkFixtureDirectory,
  responseBodyExtension,
  SHARED_NETWORK_FIXTURE_CASE_ID,
  sha256Hex,
} from "./networkFixture";
import { NetworkFixtureReplayError } from "./networkFixtureError";
import { ReplayResponse } from "./ReplayResponse";
import { waitForReplayDelay } from "./replayDelay";
import { SiteError } from "./siteError";

export interface NetworkFixtureClientOptions {
  recordRoot: string;
  /** Searched in order for a movie's recording. */
  replayRoots: readonly string[];
  mode: (caseId: string) => "record" | "replay";
  /** Writes a movie's recording whenever one of its scrape phases ends, replacing the previous recording. */
  autosave?: boolean;
  /** Keeps only sites whose outcome is a fact about the movie rather than about the recording network. */
  discardNetworkFailures?: boolean;
  /** Lets requests made outside any scrape reach the network instead of failing. */
  allowUnscopedLive?: boolean;
  mockMediaRoot: string;
  delayMs?: number;
  network?: Omit<NetworkClientOptions, "rawDispatch">;
}

interface RecordedInteraction {
  interaction: NetworkFixtureInteraction;
  contentType?: string | null;
  fileBody?: Uint8Array;
}

interface RecordingSession {
  caseId: string;
  interactions: RecordedInteraction[];
  nextSequenceByChannel: Map<string, number>;
  redactor: NetworkCredentialRedactor;
  siteResults: Map<Website, SiteResult>;
  dirty: boolean;
}

interface ReplayState {
  manifest: NetworkFixtureManifest;
  root: string;
  consumed: Set<string>;
}

type ImageBody = Extract<NonNullable<NetworkFixtureInteraction["response"]>["body"], { kind: "image" }>;

const interactionKey = (interaction: Pick<NetworkFixtureInteraction, "channel" | "sequence">): string =>
  `${interaction.channel}\u0000${interaction.sequence}`;
const isImageResponse = (contentType: string | null): boolean => contentType?.startsWith("image/") ?? false;
const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
const crawlerSite = (channel: string): string | undefined =>
  channel.startsWith("crawler:") ? channel.slice("crawler:".length) : undefined;
const isSameRequest = (recorded: NetworkFixtureRequest, actual: NetworkFixtureRequest): boolean =>
  recorded.method.toUpperCase() === actual.method &&
  normalizeFixtureUrl(recorded.url) === normalizeFixtureUrl(actual.url) &&
  recorded.bodyBase64 === actual.bodyBase64;

/** The reason a site's outcome depended on the network it was recorded from, if it did. */
const networkDependentReason = (result: SiteResult): FailureReason | undefined => {
  if (result.status === "failed") {
    return result.reason && MOVIE_FACT_FAILURE_REASONS.has(result.reason) ? undefined : result.reason;
  }
  if (result.status === "skipped" && (result.skipReason === "unavailable" || result.skipReason === "cooldown")) {
    return result.reason;
  }
  return result.skipReason === "global_timeout" ? "timeout" : undefined;
};

// Recordings carry placeholder credentials, so the live request's values are swapped in before comparing.
const seedReplayRequest = async (
  request: RawNetworkRequest,
  seed: NetworkFixtureCredentialSeed,
): Promise<NetworkFixtureRequest> => {
  const url = new URL(request.url);
  for (const [name, value] of Object.entries(seed.tokens)) {
    if (url.searchParams.has(name)) url.searchParams.set(name, value);
  }

  const encodedBody = await rawRequestBodyToBase64(request.init.body);
  let body = encodedBody ? Buffer.from(encodedBody, "base64").toString("utf8") : null;
  if (body) {
    const replacements = { ...seed.cookies, ...seed.tokens };
    if (new Headers(request.init.headers).get("content-type")?.toLowerCase().includes("json")) {
      const replace = (value: unknown, key = ""): unknown => {
        if (typeof value === "string") return replacements[key] ?? value;
        if (Array.isArray(value)) return value.map((item) => replace(item, key));
        if (value && typeof value === "object") {
          return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, replace(child, name)]));
        }
        return value;
      };
      body = JSON.stringify(replace(JSON.parse(body)));
    } else {
      const form = new URLSearchParams(body);
      for (const [name, value] of Object.entries(replacements)) {
        if (form.has(name)) form.set(name, value);
      }
      body = form.toString();
    }
  }

  return {
    method: (request.init.method ?? "GET").toUpperCase(),
    url: url.toString(),
    bodyBase64: body === null ? null : Buffer.from(body).toString("base64"),
  };
};

const commonPrefixLength = (left: string, right: string): number => {
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  return index;
};

export class NetworkFixtureClient extends NetworkClient implements ScrapeItemObserver {
  readonly missingInteractions: string[] = [];
  private readonly sessions = new WeakMap<object, RecordingSession>();
  private readonly unsaved: RecordingSession[] = [];
  private readonly sharedExecution = {};
  private readonly fixtures = new Map<
    string,
    Promise<{ manifest: NetworkFixtureManifest; root: string } | undefined>
  >();
  private readonly replayStates = new WeakMap<object, Map<string, ReplayState | undefined>>();

  constructor(private readonly fixture: NetworkFixtureClientOptions) {
    super({
      ...fixture.network,
      rawDispatch: async (request, dispatch) => await this.dispatchFixture(request, dispatch),
    });
    observeScrapeItems(this);
  }

  siteSettled(item: ScrapeItemExecutionContext, result: SiteResult): void {
    if (!item.caseId || this.fixture.mode(item.caseId) !== "record") return;
    const session = this.session(item.execution, item.caseId);
    session.siteResults.set(result.site, result);
    session.dirty = true;
  }

  async phaseEnded(item: ScrapeItemExecutionContext): Promise<void> {
    if (!this.fixture.autosave) return;
    for (const session of [this.sessions.get(item.execution), this.sessions.get(this.sharedExecution)]) {
      if (session?.dirty) await this.write(session);
    }
  }

  /** Writes the first recording made of each movie since the last save and returns the movies written. */
  async save(): Promise<string[]> {
    const firstByCase = new Map<string, RecordingSession>();
    for (const session of this.unsaved.splice(0)) {
      if (!firstByCase.has(session.caseId)) firstByCase.set(session.caseId, session);
    }
    for (const session of firstByCase.values()) await this.write(session);
    return [...firstByCase.keys()];
  }

  private async dispatchFixture(
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const context = getNetworkRequestExecutionContext();
    if (!context) {
      if (this.fixture.allowUnscopedLive) return await dispatch();
      throw new NetworkFixtureReplayError(
        "Network fixtures require an active scrape channel; public network fallback is disabled",
      );
    }
    return this.fixture.mode(context.caseId) === "record"
      ? await this.record(context, request, dispatch)
      : await this.replay(context, request);
  }

  private session(execution: object, caseId: string): RecordingSession {
    const existing = this.sessions.get(execution);
    if (existing) return existing;
    const session: RecordingSession = {
      caseId,
      interactions: [],
      nextSequenceByChannel: new Map(),
      redactor: new NetworkCredentialRedactor(),
      siteResults: new Map(),
      dirty: false,
    };
    this.sessions.set(execution, session);
    if (!this.fixture.autosave) this.unsaved.push(session);
    return session;
  }

  private async record(
    context: NetworkRequestExecutionContext,
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const session = context.shared
      ? this.session(this.sharedExecution, SHARED_NETWORK_FIXTURE_CASE_ID)
      : this.session(context.execution, context.caseId);
    const sequence = (session.nextSequenceByChannel.get(context.channel) ?? 0) + 1;
    session.nextSequenceByChannel.set(context.channel, sequence);
    session.dirty = true;
    session.redactor.observeUrl(request.url);
    session.redactor.observeHeaders(request.init.headers);
    const identity = await networkRequestIdentity(request);
    if (identity.bodyBase64) {
      session.redactor.observeRequestBody(Buffer.from(identity.bodyBase64, "base64"), request.init.headers);
    }
    const interaction: NetworkFixtureInteraction = { channel: context.channel, sequence, request: identity };

    let response: RawNetworkResponse;
    let contentType: string | null;
    let bytes: Uint8Array | undefined;
    try {
      response = await dispatch();
      contentType = response.headers.get("content-type")?.toLowerCase() ?? null;
      // Replay serves a stock video, so reading a video body would only buffer it while the caller waits.
      if (!contentType?.startsWith("video/")) bytes = new Uint8Array(await response.clone().arrayBuffer());
    } catch (error) {
      interaction.transportError = {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      };
      session.interactions.push({ interaction });
      throw error;
    }

    session.redactor.observeHeaders(response.headers);
    interaction.response = {
      status: response.status,
      statusText: response.statusText,
      url: response.url || request.url,
      headers: headersToFixtureList(response.headers),
      body:
        bytes === undefined
          ? { kind: "video" }
          : isImageResponse(contentType)
            ? { kind: "image", sha256: sha256Hex(bytes), byteLength: bytes.byteLength, ...parseImageDimensions(bytes) }
            : { kind: "file", path: "", sha256: sha256Hex(bytes), byteLength: bytes.byteLength },
    };
    session.interactions.push({
      interaction,
      contentType,
      fileBody: isImageResponse(contentType) ? undefined : bytes,
    });
    return response;
  }

  private async write(session: RecordingSession): Promise<void> {
    session.dirty = false;
    // Replay cannot reproduce timing, so even a recording that keeps failures replays a timeout as an instant one.
    const skippedSites = [...session.siteResults.values()].flatMap((result) => {
      const reason = networkDependentReason(result);
      return reason && (this.fixture.discardNetworkFailures || reason === "timeout")
        ? [{ site: result.site, reason }]
        : [];
    });
    const discarded = new Set(skippedSites.map(({ site }) => `crawler:${site}`));
    const directory = resolveNetworkFixtureDirectory(this.fixture.recordRoot, session.caseId);
    const redact = (value: string) => session.redactor.redactString(value);
    const files: Array<{ path: string; bytes: Uint8Array }> = [];
    const interactions = session.interactions
      .filter(({ interaction }) => !discarded.has(interaction.channel))
      .map(({ interaction, contentType, fileBody }) => {
        const recorded: NetworkFixtureInteraction = structuredClone(interaction);
        recorded.request.url = redact(recorded.request.url);
        if (recorded.request.bodyBase64) {
          const body = session.redactor.redactBytes(Buffer.from(recorded.request.bodyBase64, "base64"));
          recorded.request.bodyBase64 = Buffer.from(body).toString("base64");
        }
        if (recorded.transportError) {
          recorded.transportError = {
            name: redact(recorded.transportError.name),
            message: redact(recorded.transportError.message),
          };
        }
        const response = recorded.response;
        if (response) {
          response.url = redact(response.url);
          response.headers = response.headers.map(([name, value]) => [name, redact(value)]);
          if (response.body.kind === "file" && fileBody) {
            const bytes = session.redactor.redactBytes(fileBody);
            const relativePath = path.posix.join(
              "responses",
              recorded.channel.replaceAll(":", "/"),
              `${String(recorded.sequence).padStart(3, "0")}${responseBodyExtension(contentType ?? null)}`,
            );
            response.body = {
              kind: "file",
              path: relativePath,
              sha256: sha256Hex(bytes),
              byteLength: bytes.byteLength,
            };
            const contentLength = response.headers.find(([name]) => name === "content-length");
            if (contentLength) contentLength[1] = String(bytes.byteLength);
            files.push({ path: relativePath, bytes });
          }
        }
        return recorded;
      })
      .sort((left, right) => left.channel.localeCompare(right.channel) || left.sequence - right.sequence);
    const manifest: NetworkFixtureManifest = {
      schemaVersion: 2,
      caseId: session.caseId,
      credentialSeed: session.redactor.seed(),
      skippedSites: skippedSites.sort((left, right) => left.site.localeCompare(right.site)),
      interactions,
    };

    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    for (const file of files) {
      await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
      await atomicWriteFile(path.join(directory, file.path), file.bytes);
    }
    await mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  private async replay(
    context: NetworkRequestExecutionContext,
    request: RawNetworkRequest,
  ): Promise<RawNetworkResponse> {
    const caseState = await this.replayState(context.execution, context.caseId);
    if (!caseState) {
      throw new NetworkFixtureReplayError(`No network recording for ${context.caseId}; record it first`);
    }
    const site = crawlerSite(context.channel);
    const skipped = caseState.manifest.skippedSites.find((entry) => entry.site === site);
    if (skipped) {
      throw new SiteError(skipped.reason, `${site} was ${skipped.reason} when ${context.caseId} was recorded`);
    }

    let matched = await this.findInteraction(request, context.channel, caseState, true);
    let state = caseState;
    if (!matched) {
      const sharedState = await this.replayState(context.execution, SHARED_NETWORK_FIXTURE_CASE_ID);
      matched = sharedState && (await this.findInteraction(request, context.channel, sharedState, false));
      if (sharedState && matched) state = sharedState;
    }
    if (!matched) {
      const identity = await networkRequestIdentity(request);
      const missing = `${context.caseId}/${context.channel}: ${identity.method} ${identity.url}`;
      this.missingInteractions.push(missing);
      throw new NetworkFixtureReplayError(
        `Missing network fixture interaction for ${missing}${this.describeClosest(identity, context.channel, caseState)}`,
      );
    }

    await waitForReplayDelay(this.fixture.delayMs ?? 0, request.init.signal);
    if (matched.transportError) {
      const error = new Error(matched.transportError.message);
      error.name = matched.transportError.name;
      throw error;
    }
    const response = matched.response;
    if (!response) throw new Error(`Network fixture interaction ${matched.sequence} has no outcome`);
    const bytes =
      response.body.kind === "file"
        ? await this.readFileBody(state, matched, response.body)
        : response.body.kind === "video"
          ? new Uint8Array(await readFile(path.resolve(this.fixture.mockMediaRoot, "sample.mp4")))
          : await this.synthesizeImage(response.headers, response.body);
    const headers = new Headers(response.headers);
    if (response.body.kind !== "file" && headers.has("content-length")) {
      headers.set("content-length", String(bytes.byteLength));
    }
    return new ReplayResponse(response.status, response.statusText, headers, response.url, bytes);
  }

  private async findInteraction(
    request: RawNetworkRequest,
    channel: string,
    state: ReplayState,
    consume: boolean,
  ): Promise<NetworkFixtureInteraction | undefined> {
    const identity = await seedReplayRequest(request, state.manifest.credentialSeed);
    const interaction = state.manifest.interactions.find(
      (candidate) =>
        candidate.channel === channel &&
        !state.consumed.has(interactionKey(candidate)) &&
        isSameRequest(candidate.request, identity),
    );
    if (interaction && consume) state.consumed.add(interactionKey(interaction));
    return interaction;
  }

  private describeClosest(identity: NetworkFixtureRequest, channel: string, state: ReplayState): string {
    const target = normalizeFixtureUrl(identity.url);
    const closest = state.manifest.interactions
      .filter((candidate) => candidate.channel === channel && !state.consumed.has(interactionKey(candidate)))
      .map((candidate) => ({
        candidate,
        score: commonPrefixLength(normalizeFixtureUrl(candidate.request.url), target),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidate;
    if (!closest)
      return `; the recording has no unconsumed ${channel} requests. Re-record with -u if the crawler changed`;
    const differences = [
      closest.request.method.toUpperCase() !== identity.method ? `method ${closest.request.method}` : "",
      normalizeFixtureUrl(closest.request.url) !== target ? `url ${closest.request.url}` : "",
      closest.request.bodyBase64 !== identity.bodyBase64 ? "body" : "",
    ].filter(Boolean);
    return `; closest recorded request differs in ${differences.join(", ")}. Re-record with -u if the crawler changed`;
  }

  private async replayState(execution: object, caseId: string): Promise<ReplayState | undefined> {
    let states = this.replayStates.get(execution);
    if (!states) {
      states = new Map();
      this.replayStates.set(execution, states);
    }
    if (states.has(caseId)) return states.get(caseId);
    let fixture = this.fixtures.get(caseId);
    if (!fixture) {
      fixture = this.findFixture(caseId);
      this.fixtures.set(caseId, fixture);
    }
    const found = await fixture;
    const state = found && { ...found, consumed: new Set<string>() };
    states.set(caseId, state);
    return state;
  }

  private async findFixture(caseId: string): Promise<{ manifest: NetworkFixtureManifest; root: string } | undefined> {
    for (const root of this.fixture.replayRoots) {
      try {
        return { manifest: await loadNetworkFixture(root, caseId), root };
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return undefined;
  }

  private async readFileBody(
    state: ReplayState,
    interaction: NetworkFixtureInteraction,
    body: { path: string; sha256: string; byteLength: number },
  ): Promise<Uint8Array> {
    const bytes = await readFile(
      path.join(resolveNetworkFixtureDirectory(state.root, state.manifest.caseId), body.path),
    );
    if (bytes.byteLength !== body.byteLength || sha256Hex(bytes) !== body.sha256) {
      throw new Error(
        `Network fixture response body mismatch at ${state.manifest.caseId}/${interaction.channel}#${interaction.sequence}`,
      );
    }
    return new Uint8Array(bytes);
  }

  private async synthesizeImage(headers: Array<[string, string]>, body: ImageBody): Promise<Uint8Array> {
    const contentType = headers.find(([name]) => name === "content-type")?.[1]?.toLowerCase() ?? "";
    // A recorded body that did not decode as an image replays as undecodable bytes of the same size.
    if (!body.width || !body.height) return new Uint8Array(body.byteLength);
    const [red, green, blue] = Buffer.from(body.sha256.slice(0, 6), "hex");
    const format = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpeg";
    const image = await sharp({
      create: { width: body.width, height: body.height, channels: 3, background: { r: red, g: green, b: blue } },
    })
      .toFormat(format)
      .toBuffer();
    // Padding to the recorded size keeps byte-size thresholds and content-length behaving as with the real image.
    const bytes = new Uint8Array(Math.max(body.byteLength, image.byteLength));
    bytes.set(image);
    return bytes;
  }
}
