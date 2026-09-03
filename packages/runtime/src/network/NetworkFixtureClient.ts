import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";
import { NetworkCredentialRedactor } from "./networkCredentials";
import {
  fixtureCaseIdFromRelativePath,
  headersToFixtureList,
  loadNetworkFixture,
  type NetworkFixtureCredentialSeed,
  type NetworkFixtureInteraction,
  type NetworkFixtureManifest,
  networkRequestIdentity,
  rawRequestBodyToBase64,
  resolveNetworkFixtureBlob,
  resolveNetworkFixtureDirectory,
  responseBodyExtension,
  sha256Hex,
} from "./networkFixture";
import { getNetworkFixtureContext, type NetworkFixtureContext } from "./networkFixtureContext";
import { ReplayResponse } from "./ReplayResponse";
import { waitForReplayDelay } from "./replayDelay";

interface RecordingSession {
  caseId: string;
  interactions: NetworkFixtureInteraction[];
  nextSequenceByChannel: Map<string, number>;
  redactor: NetworkCredentialRedactor;
  stagingDirectory: string;
}

interface ReplayState {
  manifest: NetworkFixtureManifest;
  consumed: Set<string>;
}

export interface NetworkRecordClientOptions {
  stagingRoot: string;
  publishRoot: string;
  network?: Omit<NetworkClientOptions, "rawDispatch">;
}

export interface NetworkReplayClientOptions {
  fixturesRoot: string;
  mockMediaRoot?: string;
  delayMs?: number;
  network?: Omit<NetworkClientOptions, "rawDispatch">;
}

const interactionKey = (interaction: Pick<NetworkFixtureInteraction, "channel" | "sequence">): string =>
  `${interaction.channel}\u0000${interaction.sequence}`;
const isBlobResponse = (response: RawNetworkResponse): boolean =>
  /^(image|video)\//u.test(response.headers.get("content-type")?.toLowerCase() ?? "");
const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

const seedReplayRequest = async (
  request: RawNetworkRequest,
  seed: NetworkFixtureCredentialSeed,
): Promise<NetworkFixtureInteraction["request"]> => {
  const url = new URL(request.url);
  for (const [name, value] of Object.entries(seed.tokens)) {
    if (url.searchParams.has(name)) url.searchParams.set(name, value);
  }

  const headers = new Headers(request.init.headers);
  if (headers.has("cookie")) {
    const cookies = new Map<string, string>();
    for (const part of headers.get("cookie")?.split(";") ?? []) {
      const separator = part.indexOf("=");
      if (separator > 0) cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
    }
    for (const [name, value] of Object.entries(seed.cookies)) {
      if (cookies.has(name)) cookies.set(name, value);
    }
    headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  }
  const authorization = seed.tokens.authorization;
  if (authorization && headers.has("authorization")) {
    const original = headers.get("authorization") ?? "";
    headers.set("authorization", /^Bearer\s/iu.test(original) ? `Bearer ${authorization}` : authorization);
  }
  const csrf = seed.tokens.csrf;
  if (csrf) {
    if (headers.has("x-xsrf-token")) headers.set("x-xsrf-token", csrf);
    if (headers.has("x-csrf-token")) headers.set("x-csrf-token", csrf);
  }

  const encodedBody = await rawRequestBodyToBase64(request.init.body);
  let body = encodedBody ? Buffer.from(encodedBody, "base64").toString("utf8") : null;
  if (body) {
    const replacements = { ...seed.cookies, ...seed.tokens };
    const contentType = headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("json")) {
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
    if (headers.has("content-length")) headers.set("content-length", String(Buffer.byteLength(body)));
  }

  return {
    method: (request.init.method ?? "GET").toUpperCase(),
    url: url.toString(),
    headers: headersToFixtureList(headers),
    bodyBase64: body === null ? null : Buffer.from(body).toString("base64"),
  };
};

export class NetworkRecordClient extends NetworkClient {
  private readonly stagingRoot: string;
  private readonly publishRoot: string;
  private readonly sessions = new Map<object, RecordingSession>();
  private nextSessionId = 0;

  constructor(options: NetworkRecordClientOptions) {
    super({
      ...options.network,
      rawDispatch: async (request, dispatch) => await this.dispatchAndRecord(request, dispatch),
    });
    this.stagingRoot = path.resolve(options.stagingRoot);
    this.publishRoot = path.resolve(options.publishRoot);
  }

  async finalize(): Promise<void> {
    if (this.sessions.size === 0) throw new Error("Recording did not capture any network interactions");
    const latestSessionByCase = new Map<string, RecordingSession>();
    for (const session of this.sessions.values()) latestSessionByCase.set(session.caseId, session);

    for (const session of latestSessionByCase.values()) {
      for (const interaction of session.interactions) await this.finalizeInteraction(session, interaction);
      const directory = session.stagingDirectory;
      const manifest: NetworkFixtureManifest = {
        schemaVersion: 1,
        caseId: session.caseId,
        credentialSeed: session.redactor.seed(),
        interactions: session.interactions.sort(
          (left, right) => left.channel.localeCompare(right.channel) || left.sequence - right.sequence,
        ),
      };
      await mkdir(directory, { recursive: true });
      await atomicWriteFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      const destination = resolveNetworkFixtureDirectory(this.publishRoot, session.caseId);
      await rm(destination, { recursive: true, force: true });
      await cp(directory, destination, { recursive: true });
    }
  }

  private async dispatchAndRecord(
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const context = getNetworkFixtureContext();
    if (!context) return await dispatch();
    const session = this.session(context);
    const sequence = (session.nextSequenceByChannel.get(context.channel) ?? 0) + 1;
    session.nextSequenceByChannel.set(context.channel, sequence);

    let response: RawNetworkResponse;
    try {
      response = await dispatch();
    } catch (error) {
      session.interactions.push(await this.createInteraction(session, context.channel, sequence, request, { error }));
      throw error;
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    session.interactions.push(
      await this.createInteraction(session, context.channel, sequence, request, { response, bytes }),
    );
    return response;
  }

  private session(context: NetworkFixtureContext): RecordingSession {
    const existing = this.sessions.get(context.execution);
    if (existing) return existing;
    const session = {
      caseId: context.caseId,
      interactions: [],
      nextSequenceByChannel: new Map<string, number>(),
      redactor: new NetworkCredentialRedactor(),
      stagingDirectory: path.join(this.stagingRoot, String(++this.nextSessionId), context.caseId),
    };
    this.sessions.set(context.execution, session);
    return session;
  }

  private async createInteraction(
    session: RecordingSession,
    channel: string,
    sequence: number,
    request: RawNetworkRequest,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): Promise<NetworkFixtureInteraction> {
    session.redactor.observeUrl(request.url);
    session.redactor.observeHeaders(request.init.headers);
    const identity = await networkRequestIdentity(request);
    if (identity.bodyBase64) {
      session.redactor.observeRequestBody(Buffer.from(identity.bodyBase64, "base64"), request.init.headers);
    }
    const interaction: NetworkFixtureInteraction = { channel, sequence, request: identity };

    if ("error" in outcome) {
      interaction.transportError = {
        name: outcome.error instanceof Error ? outcome.error.name : "Error",
        message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      };
      this.redact(session, interaction);
      return interaction;
    }

    session.redactor.observeHeaders(outcome.response.headers);
    const sha256 = sha256Hex(outcome.bytes);
    if (isBlobResponse(outcome.response)) {
      const blobPath = resolveNetworkFixtureBlob(this.publishRoot, sha256);
      await mkdir(path.dirname(blobPath), { recursive: true });
      await atomicWriteFile(blobPath, outcome.bytes);
      interaction.response = {
        status: outcome.response.status,
        statusText: outcome.response.statusText,
        url: outcome.response.url || request.url,
        headers: headersToFixtureList(outcome.response.headers),
        body: { kind: "blob", sha256, byteLength: outcome.bytes.byteLength },
      };
    } else {
      const relativePath = path.posix.join(
        "responses",
        channel.replaceAll(":", "/"),
        `${String(sequence).padStart(3, "0")}${responseBodyExtension(outcome.response.headers.get("content-type"))}`,
      );
      const bodyPath = path.join(session.stagingDirectory, relativePath);
      await mkdir(path.dirname(bodyPath), { recursive: true });
      await atomicWriteFile(bodyPath, outcome.bytes);
      interaction.response = {
        status: outcome.response.status,
        statusText: outcome.response.statusText,
        url: outcome.response.url || request.url,
        headers: headersToFixtureList(outcome.response.headers),
        body: { kind: "file", path: relativePath, sha256, byteLength: outcome.bytes.byteLength },
      };
    }
    this.redact(session, interaction);
    return interaction;
  }

  private async finalizeInteraction(session: RecordingSession, interaction: NetworkFixtureInteraction): Promise<void> {
    this.redact(session, interaction);
    const body = interaction.response?.body;
    if (body?.kind !== "file") return;
    const bodyPath = path.join(session.stagingDirectory, body.path);
    const original = await readFile(bodyPath);
    const redacted = session.redactor.redactBytes(original);
    if (!original.equals(redacted)) await atomicWriteFile(bodyPath, redacted);
    body.sha256 = sha256Hex(redacted);
    body.byteLength = redacted.byteLength;
    this.updateContentLength(interaction.response?.headers, redacted.byteLength);
  }

  private redact(session: RecordingSession, interaction: NetworkFixtureInteraction): void {
    interaction.request.url = session.redactor.redactString(interaction.request.url);
    interaction.request.headers = this.redactHeaders(session, interaction.request.headers);
    if (interaction.request.bodyBase64) {
      const redacted = session.redactor.redactBytes(Buffer.from(interaction.request.bodyBase64, "base64"));
      interaction.request.bodyBase64 = Buffer.from(redacted).toString("base64");
      this.updateContentLength(interaction.request.headers, redacted.byteLength);
    }
    if (interaction.response) {
      interaction.response.url = session.redactor.redactString(interaction.response.url);
      interaction.response.headers = this.redactHeaders(session, interaction.response.headers);
    }
    if (interaction.transportError) {
      interaction.transportError.name = session.redactor.redactString(interaction.transportError.name);
      interaction.transportError.message = session.redactor.redactString(interaction.transportError.message);
    }
  }

  private redactHeaders(session: RecordingSession, headers: Array<[string, string]>): Array<[string, string]> {
    return headers.map(([name, value]) => [name, session.redactor.redactString(value)]);
  }

  private updateContentLength(headers: Array<[string, string]> | undefined, length: number): void {
    const header = headers?.find(([name]) => name === "content-length");
    if (header) header[1] = String(length);
  }
}

export class NetworkReplayClient extends NetworkClient {
  private readonly fixturesRoot: string;
  private readonly mockMediaRoot: string;
  private readonly delayMs: number;
  private readonly fixtures = new Map<string, Promise<NetworkFixtureManifest>>();
  private readonly states = new WeakMap<object, Map<string, ReplayState>>();

  constructor(options: NetworkReplayClientOptions) {
    super({
      ...options.network,
      rawDispatch: async (request) => await this.dispatchFixture(request),
    });
    this.fixturesRoot = path.resolve(options.fixturesRoot);
    this.mockMediaRoot = options.mockMediaRoot
      ? path.resolve(options.mockMediaRoot)
      : path.resolve(this.fixturesRoot, "../mock-media");
    this.delayMs = options.delayMs ?? 0;
  }

  private async dispatchFixture(request: RawNetworkRequest): Promise<RawNetworkResponse> {
    const context = getNetworkFixtureContext();
    if (!context)
      throw new Error("Network replay requires an active fixture channel; public network fallback is disabled");
    const state = await this.getState(context);
    const identity = await seedReplayRequest(request, state.manifest.credentialSeed);
    const interaction = state.manifest.interactions.find(
      (candidate) =>
        candidate.channel === context.channel &&
        !state.consumed.has(interactionKey(candidate)) &&
        candidate.request.method.toUpperCase() === identity.method &&
        candidate.request.url === identity.url &&
        candidate.request.bodyBase64 === identity.bodyBase64 &&
        JSON.stringify(candidate.request.headers) === JSON.stringify(identity.headers),
    );
    if (!interaction) {
      throw new Error(
        `Missing network fixture interaction for ${context.caseId}/${context.channel}: ${identity.method} ${identity.url}`,
      );
    }

    state.consumed.add(interactionKey(interaction));
    await waitForReplayDelay(this.delayMs, request.init.signal);
    if (interaction.transportError) {
      const error = new Error(interaction.transportError.message);
      error.name = interaction.transportError.name;
      throw error;
    }
    if (!interaction.response) throw new Error(`Network fixture interaction ${interaction.sequence} has no outcome`);
    const bytes = await this.loadResponseBody(context.caseId, interaction);
    const headers = new Headers(interaction.response.headers);
    if (interaction.response.body.kind === "blob" && headers.has("content-length")) {
      headers.set("content-length", String(bytes.byteLength));
    }
    return new ReplayResponse(
      interaction.response.status,
      interaction.response.statusText,
      headers,
      interaction.response.url,
      bytes,
    );
  }

  private async getState(context: NetworkFixtureContext): Promise<ReplayState> {
    let executionStates = this.states.get(context.execution);
    if (!executionStates) {
      executionStates = new Map();
      this.states.set(context.execution, executionStates);
    }
    const existing = executionStates.get(context.caseId);
    if (existing) return existing;
    let fixture = this.fixtures.get(context.caseId);
    if (!fixture) {
      fixture = loadNetworkFixture(this.fixturesRoot, context.caseId);
      this.fixtures.set(context.caseId, fixture);
    }
    const state = { manifest: await fixture, consumed: new Set<string>() };
    executionStates.set(context.caseId, state);
    return state;
  }

  private async loadResponseBody(caseId: string, interaction: NetworkFixtureInteraction): Promise<Uint8Array> {
    const body = interaction.response?.body;
    if (!body) throw new Error(`Network fixture interaction ${interaction.sequence} has no response body`);
    let bytes: Buffer;
    try {
      bytes = await readFile(
        body.kind === "file"
          ? path.join(resolveNetworkFixtureDirectory(this.fixturesRoot, caseId), body.path)
          : resolveNetworkFixtureBlob(this.fixturesRoot, body.sha256),
      );
    } catch (error) {
      if (!isNotFound(error) || body.kind !== "blob") throw error;
      const type = interaction.response?.headers.find(([name]) => name === "content-type")?.[1]?.toLowerCase() ?? "";
      const file = type.startsWith("video/") ? "sample.mp4" : "sample.jpg";
      bytes = await readFile(path.resolve(this.mockMediaRoot, file));
      return new Uint8Array(bytes);
    }
    if (bytes.byteLength !== body.byteLength || sha256Hex(bytes) !== body.sha256) {
      throw new Error(
        `Network fixture response body mismatch at ${caseId}/${interaction.channel}#${interaction.sequence}`,
      );
    }
    return new Uint8Array(bytes);
  }
}

interface NetworkFixtureSettings {
  mode: "record" | "replay";
  root: string;
  stagingRoot: string;
  delayMs: number;
}

let envRecorder: NetworkRecordClient | undefined;

const networkFixtureSettings = (env: NodeJS.ProcessEnv): NetworkFixtureSettings | undefined => {
  const mode = env.MDCZ_NETWORK_FIXTURE_MODE?.trim();
  if (!mode) return undefined;
  if (mode !== "record" && mode !== "replay") throw new Error(`Invalid MDCZ_NETWORK_FIXTURE_MODE: ${mode}`);
  const delayMs = Number(env.MDCZ_REPLAY_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`MDCZ_REPLAY_DELAY_MS must be a non-negative number, got ${env.MDCZ_REPLAY_DELAY_MS}`);
  }
  return {
    mode,
    root: env.MDCZ_NETWORK_FIXTURES_ROOT || "tests/fixtures/network",
    stagingRoot: env.MDCZ_NETWORK_FIXTURE_STAGING || "test-results/recording/network",
    delayMs,
  };
};

export const createNetworkClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkClient => {
  const fixture = networkFixtureSettings(env);
  if (!fixture) return new NetworkClient(options);
  if (fixture.mode === "record") {
    const client = new NetworkRecordClient({
      stagingRoot: fixture.stagingRoot,
      publishRoot: fixture.root,
      network: options,
    });
    if (env === process.env) envRecorder = client;
    return client;
  }
  return new NetworkReplayClient({ fixturesRoot: fixture.root, delayMs: fixture.delayMs, network: options });
};

export const attachNetworkFixtureCaseId = <T extends { relativePath: string; caseId?: string }>(item: T): T =>
  networkFixtureSettings(process.env) ? { ...item, caseId: fixtureCaseIdFromRelativePath(item.relativePath) } : item;

export const finalizeNetworkFixtures = async (): Promise<void> => {
  await envRecorder?.finalize();
};
