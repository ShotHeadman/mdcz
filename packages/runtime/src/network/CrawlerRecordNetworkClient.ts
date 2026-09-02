import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import type { Website } from "@mdcz/shared/enums";
import { CrawlerReplayNetworkClient } from "./CrawlerReplayNetworkClient";
import {
  type CrawlerCassette,
  type CrawlerCassetteInteraction,
  crawlerCaseIdFromRelativePath,
  headersToCassetteList,
  rawRequestBodyToBase64,
  resolveCrawlerCassetteDirectory,
  responseBodyExtension,
  sha256Hex,
} from "./crawlerCassette";
import { CrawlerCredentialRedactor } from "./crawlerCredentials";
import { getCrawlerFixtureContext, getMediaFixtureContext } from "./crawlerFixtureContext";
import {
  type CrawlerRecordingObservation,
  publishCrawlerRecordingStaging,
  validateCrawlerRecordingStaging,
} from "./crawlerRecordingPublish";
import { MediaFixtureRecorder } from "./MediaFixtureRecorder";
import { DEFAULT_MOCK_MEDIA_ROOT } from "./mediaFixture";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";

export interface CrawlerRecordNetworkClientOptions {
  stagingRoot: string;
  publishRoot: string;
  mediaManifestStagingRoot?: string;
  mediaManifestPublishRoot?: string;
  mediaBlobRoot?: string;
  receiptPath?: string;
  network?: Omit<NetworkClientOptions, "rawDispatch">;
}

interface SessionState {
  website: Website;
  caseId: string;
  relativePath: string;
  nextSequence: number;
  interactions: Map<number, CrawlerCassetteInteraction>;
  observedReals: Set<string>;
  writeChain: Promise<void>;
}

const sessionKey = (website: Website, caseId: string): string => `${website}\u0000${caseId}`;
const fixtureCaseIdBindings = new Map<string, string>();

const paddedSequence = (sequence: number): string => String(sequence).padStart(3, "0");

const captureResponseBytes = async (response: RawNetworkResponse): Promise<Uint8Array> => {
  const cloned = response.clone();
  return new Uint8Array(await cloned.arrayBuffer());
};

export class CrawlerRecordNetworkClient extends NetworkClient {
  private readonly stagingRoot: string;
  private readonly publishRoot: string;
  private readonly mediaManifestStagingRoot: string;
  private readonly redactor = new CrawlerCredentialRedactor();
  private readonly receiptPath: string | undefined;
  private readonly sessions = new Map<string, SessionState>();
  private readonly sequenceLocks = new Map<string, Promise<void>>();
  private readonly mediaRecorder: MediaFixtureRecorder;

  constructor(options: CrawlerRecordNetworkClientOptions) {
    super({
      ...options.network,
      rawDispatch: async (request, dispatch) => await this.dispatchAndRecord(request, dispatch),
    });
    this.stagingRoot = path.resolve(options.stagingRoot);
    this.publishRoot = path.resolve(options.publishRoot);
    this.receiptPath = options.receiptPath ? path.resolve(options.receiptPath) : undefined;
    this.mediaManifestStagingRoot = path.resolve(
      options.mediaManifestStagingRoot ?? "test-results/recording/media-staging",
    );
    this.mediaRecorder = new MediaFixtureRecorder(
      {
        stagingRoot: this.mediaManifestStagingRoot,
        publishRoot: path.resolve(options.mediaManifestPublishRoot ?? "tests/fixtures/media"),
        blobRoot: path.resolve(options.mediaBlobRoot ?? "tests/fixtures/media"),
      },
      this.redactor,
    );
  }

  observations(): CrawlerRecordingObservation[] {
    return [...this.sessions.values()].map((session) => ({
      relativePath: session.relativePath,
      caseId: session.caseId,
      website: session.website,
    }));
  }

  async finalize(): Promise<void> {
    await Promise.all([
      ...[...this.sessions.values()].map(async (session) => await session.writeChain),
      this.mediaRecorder.flush(),
    ]);
    await Promise.all([...this.sessions.values()].map(async (session) => await this.refreshRedactions(session)));
    const crawlerPublishOptions = {
      stagingRoot: this.stagingRoot,
      publishRoot: this.publishRoot,
      observations: this.observations(),
      redactor: this.redactor,
    };
    if (this.sessions.size + this.mediaRecorder.caseIds().length === 0) {
      throw new Error("Recording did not capture any crawler or media interactions");
    }
    await Promise.all([validateCrawlerRecordingStaging(crawlerPublishOptions), this.mediaRecorder.validate()]);
    const receiptFiles = await Promise.all([
      ...this.observations().map(async ({ website, caseId }) => {
        const filePath = path.join(resolveCrawlerCassetteDirectory(this.stagingRoot, website, caseId), "cassette.json");
        return {
          path: path.posix.join("crawler", website, caseId, "cassette.json"),
          sha256: sha256Hex(await readFile(filePath)),
        };
      }),
      ...this.mediaRecorder.caseIds().map(async (caseId) => {
        const filePath = path.join(this.mediaManifestStagingRoot, caseId, "manifest.json");
        return {
          path: path.posix.join("media", caseId, "manifest.json"),
          sha256: sha256Hex(await readFile(filePath)),
        };
      }),
    ]);
    if (this.receiptPath) {
      await mkdir(path.dirname(this.receiptPath), { recursive: true });
      await atomicWriteFile(
        this.receiptPath,
        `${JSON.stringify({ schemaVersion: 1, files: receiptFiles.sort((left, right) => left.path.localeCompare(right.path)) }, null, 2)}\n`,
      );
    }
    await publishCrawlerRecordingStaging(crawlerPublishOptions);
    await this.mediaRecorder.publish();
    fixtureCaseIdBindings.clear();
  }

  private async dispatchAndRecord(
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const context = getCrawlerFixtureContext();
    if (!context) {
      const mediaContext = getMediaFixtureContext();
      return mediaContext ? await this.mediaRecorder.dispatch(mediaContext, request, dispatch) : await dispatch();
    }

    const { website } = context.source;
    const { caseId, relativePath } = context.item;
    const derivedCaseId = crawlerCaseIdFromRelativePath(relativePath);
    if (derivedCaseId !== caseId) {
      throw new Error(`Recording caseId mismatch for ${relativePath}: expected ${derivedCaseId}, got ${caseId}`);
    }

    const key = sessionKey(website, caseId);
    const sequence = await this.allocateSequence(key, website, caseId, relativePath);
    try {
      const response = await dispatch();
      const bytes = await captureResponseBytes(response);
      await this.recordInteraction(key, sequence, request, { response, bytes });
      return response;
    } catch (error) {
      await this.recordInteraction(key, sequence, request, { error });
      throw error;
    }
  }

  private async allocateSequence(key: string, website: Website, caseId: string, relativePath: string): Promise<number> {
    const previous = this.sequenceLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sequenceLocks.set(
      key,
      previous.then(() => current),
    );
    await previous;
    try {
      const session = this.getSession(key, website, caseId, relativePath);
      session.nextSequence += 1;
      return session.nextSequence;
    } finally {
      release();
    }
  }

  private getSession(key: string, website: Website, caseId: string, relativePath: string): SessionState {
    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.relativePath !== relativePath) {
        throw new Error(
          `Crawler recording caseId ${caseId} is already bound to ${existing.relativePath}, not ${relativePath}`,
        );
      }
      return existing;
    }
    const session: SessionState = {
      website,
      caseId,
      relativePath,
      nextSequence: 0,
      interactions: new Map(),
      observedReals: new Set(),
      writeChain: Promise.resolve(),
    };
    this.sessions.set(key, session);
    return session;
  }

  private async recordInteraction(
    key: string,
    sequence: number,
    request: RawNetworkRequest,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) throw new Error(`Crawler recording session is missing for ${key}`);

    this.redactor.observeUrl(request.url);
    this.redactor.observeHeaders(request.init.headers);
    const requestBodyBytes = await this.requestBodyBytes(request);
    if (requestBodyBytes) this.redactor.observeRequestBody(requestBodyBytes, request.init.headers);
    if ("response" in outcome) this.redactor.observeHeaders(outcome.response.headers);

    const inspect = this.inspectionText(request, requestBodyBytes, outcome);
    for (const secret of this.redactor.secrets()) {
      if (inspect.includes(secret.real)) session.observedReals.add(secret.real);
    }

    const redactedUrl = this.redactor.redactString(request.url);
    const redactedRequestHeaders = this.redactHeaders(request.init.headers);
    const redactedRequestBody = requestBodyBytes ? this.redactor.redactBytes(requestBodyBytes) : null;
    if (
      requestBodyBytes &&
      redactedRequestBody &&
      requestBodyBytes.byteLength !== redactedRequestBody.byteLength &&
      redactedRequestHeaders.has("content-length")
    ) {
      redactedRequestHeaders.set("content-length", String(redactedRequestBody.byteLength));
    }
    const interaction: CrawlerCassetteInteraction = {
      sequence,
      request: {
        method: (request.init.method ?? "GET").toUpperCase(),
        url: redactedUrl,
        headers: headersToCassetteList(redactedRequestHeaders),
        bodyBase64: redactedRequestBody ? Buffer.from(redactedRequestBody).toString("base64") : null,
      },
    };

    if ("error" in outcome) {
      const error = outcome.error;
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      interaction.transportError = {
        name: this.redactor.redactString(name),
        message: this.redactor.redactString(message),
      };
    } else {
      const redactedHeaders = this.redactHeaders(outcome.response.headers);
      const redactedBody = this.redactor.redactBytes(outcome.bytes);
      if (redactedBody.byteLength !== outcome.bytes.byteLength && redactedHeaders.has("content-length")) {
        redactedHeaders.set("content-length", String(redactedBody.byteLength));
      }
      const extension = responseBodyExtension(outcome.response.headers.get("content-type"), redactedBody.byteLength);
      const bodyPath = path.posix.join("responses", `${paddedSequence(sequence)}${extension}`);
      const directory = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
      await mkdir(path.join(directory, "responses"), { recursive: true });
      await atomicWriteFile(path.join(directory, bodyPath), redactedBody);
      interaction.response = {
        status: outcome.response.status,
        statusText: outcome.response.statusText,
        url: this.redactor.redactString(outcome.response.url || request.url),
        headers: headersToCassetteList(redactedHeaders),
        bodyPath,
        sha256: sha256Hex(redactedBody),
      };
    }

    session.interactions.set(sequence, interaction);
    session.writeChain = session.writeChain.then(async () => await this.writeCassette(session));
    await session.writeChain;
  }

  private inspectionText(
    request: RawNetworkRequest,
    requestBodyBytes: Uint8Array | null,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): string {
    const headerText = headersToCassetteList(request.init.headers)
      .map(([name, value]) => `${name}:${value}`)
      .join("\n");
    const parts = [request.url, headerText, requestBodyBytes ? Buffer.from(requestBodyBytes).toString("utf8") : ""];
    if ("error" in outcome) {
      parts.push(
        outcome.error instanceof Error ? `${outcome.error.name}:${outcome.error.message}` : String(outcome.error),
      );
      return parts.join("\n");
    }
    const responseHeaders = headersToCassetteList(outcome.response.headers)
      .map(([name, value]) => `${name}:${value}`)
      .join("\n");
    parts.push(outcome.response.url, responseHeaders, Buffer.from(outcome.bytes).toString("utf8"));
    return parts.join("\n");
  }

  private redactHeaders(headers: Headers): Headers {
    const redacted = new Headers();
    for (const [name, value] of headersToCassetteList(headers)) {
      redacted.append(name, this.redactor.redactString(value));
    }
    return redacted;
  }

  private async requestBodyBytes(request: RawNetworkRequest): Promise<Uint8Array | null> {
    const encoded = await rawRequestBodyToBase64(request.init.body);
    return encoded ? new Uint8Array(Buffer.from(encoded, "base64")) : null;
  }

  private async refreshRedactions(session: SessionState): Promise<void> {
    const directory = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
    for (const interaction of session.interactions.values()) {
      const requestBody = interaction.request.bodyBase64 ? Buffer.from(interaction.request.bodyBase64, "base64") : null;
      let responseBody: Uint8Array | null = null;
      if (interaction.response) responseBody = await readFile(path.join(directory, interaction.response.bodyPath));
      const inspect = [
        interaction.request.url,
        JSON.stringify(interaction.request.headers),
        requestBody ? Buffer.from(requestBody).toString("utf8") : "",
        interaction.response?.url ?? "",
        JSON.stringify(interaction.response?.headers ?? []),
        responseBody ? Buffer.from(responseBody).toString("utf8") : "",
        interaction.transportError?.name ?? "",
        interaction.transportError?.message ?? "",
      ].join("\n");
      for (const secret of this.redactor.secrets()) {
        if (inspect.includes(secret.real)) session.observedReals.add(secret.real);
      }

      interaction.request.url = this.redactor.redactString(interaction.request.url);
      const requestHeaders = this.redactHeaders(new Headers(interaction.request.headers));
      if (requestBody) {
        const redacted = this.redactor.redactBytes(requestBody);
        interaction.request.bodyBase64 = Buffer.from(redacted).toString("base64");
        if (requestBody.byteLength !== redacted.byteLength && requestHeaders.has("content-length")) {
          requestHeaders.set("content-length", String(redacted.byteLength));
        }
      }
      interaction.request.headers = headersToCassetteList(requestHeaders);

      if (interaction.response && responseBody) {
        const redacted = this.redactor.redactBytes(responseBody);
        const responseHeaders = this.redactHeaders(new Headers(interaction.response.headers));
        if (responseBody.byteLength !== redacted.byteLength && responseHeaders.has("content-length")) {
          responseHeaders.set("content-length", String(redacted.byteLength));
        }
        interaction.response.url = this.redactor.redactString(interaction.response.url);
        interaction.response.headers = headersToCassetteList(responseHeaders);
        interaction.response.sha256 = sha256Hex(redacted);
        await atomicWriteFile(path.join(directory, interaction.response.bodyPath), redacted);
      }
      if (interaction.transportError) {
        interaction.transportError.name = this.redactor.redactString(interaction.transportError.name);
        interaction.transportError.message = this.redactor.redactString(interaction.transportError.message);
      }
    }
    await this.writeCassette(session);
  }

  private async writeCassette(session: SessionState): Promise<void> {
    const interactions = [...session.interactions.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, interaction]) => interaction);
    const cassette: CrawlerCassette = {
      schemaVersion: 1,
      caseId: session.caseId,
      website: session.website,
      credentialSeed: this.redactor.seed(session.observedReals),
      interactions,
    };
    const directory = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
    await mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, "cassette.json"), `${JSON.stringify(cassette, null, 2)}\n`);
  }
}

const DEFAULT_STAGING_ROOT = "test-results/recording/staging";
const DEFAULT_PUBLISH_ROOT = "tests/fixtures/crawler";
const DEFAULT_MEDIA_MANIFEST_STAGING_ROOT = "test-results/recording/media-staging";
const DEFAULT_MEDIA_MANIFEST_PUBLISH_ROOT = "tests/fixtures/media";
const DEFAULT_MEDIA_BLOB_ROOT = "tests/fixtures/media";

interface ResolvedRecordingSettings {
  stagingRoot: string;
  publishRoot: string;
  mediaManifestStagingRoot: string;
  mediaManifestPublishRoot: string;
  mediaBlobRoot: string;
  receiptPath: string;
}

interface ResolvedReplaySettings {
  crawlerFixturesRoot: string;
  mediaManifestRoot: string;
  mediaBlobRoot: string;
  mockMediaRoot: string;
  fallbackToMock: boolean;
}

let envSettings: ResolvedRecordingSettings | undefined;
let envSettingsResolved = false;
let envRecorder: CrawlerRecordNetworkClient | undefined;
let envReplaySettings: ResolvedReplaySettings | undefined;
let envReplaySettingsResolved = false;
let envReplay: CrawlerReplayNetworkClient | undefined;

const envFlagEnabled = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const resolveCrawlerRecordingSettingsFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRecordingSettings | undefined => {
  if (!envFlagEnabled(env.MDCZ_RECORD_CRAWLER)) return undefined;
  return {
    stagingRoot: env.MDCZ_RECORD_STAGING?.trim() || DEFAULT_STAGING_ROOT,
    publishRoot: env.MDCZ_RECORD_PUBLISH?.trim() || DEFAULT_PUBLISH_ROOT,
    mediaManifestStagingRoot: env.MDCZ_RECORD_MEDIA_STAGING?.trim() || DEFAULT_MEDIA_MANIFEST_STAGING_ROOT,
    mediaManifestPublishRoot: env.MDCZ_RECORD_MEDIA_PUBLISH?.trim() || DEFAULT_MEDIA_MANIFEST_PUBLISH_ROOT,
    mediaBlobRoot: env.MDCZ_RECORD_MEDIA_BLOBS?.trim() || DEFAULT_MEDIA_BLOB_ROOT,
    receiptPath: env.MDCZ_RECORD_RECEIPT?.trim() || "test-results/recording/validated.json",
  };
};

const cachedRecordingSettings = (): ResolvedRecordingSettings | undefined => {
  if (!envSettingsResolved) {
    envSettingsResolved = true;
    envSettings = resolveCrawlerRecordingSettingsFromEnv();
  }
  return envSettings;
};

const resolveCrawlerReplaySettingsFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ResolvedReplaySettings | undefined => {
  if (!envFlagEnabled(env.MDCZ_REPLAY_CRAWLER)) return undefined;
  return {
    crawlerFixturesRoot: env.MDCZ_REPLAY_CRAWLER_FIXTURES?.trim() || "tests/fixtures/crawler",
    mediaManifestRoot: env.MDCZ_REPLAY_MEDIA_MANIFESTS?.trim() || "tests/fixtures/media",
    mediaBlobRoot: env.MDCZ_REPLAY_MEDIA_BLOBS?.trim() || "tests/fixtures/media",
    mockMediaRoot: env.MDCZ_MOCK_MEDIA?.trim() || DEFAULT_MOCK_MEDIA_ROOT,
    fallbackToMock: !envFlagEnabled(env.MDCZ_MEDIA_REPLAY_STRICT),
  };
};

const cachedReplaySettings = (): ResolvedReplaySettings | undefined => {
  if (!envReplaySettingsResolved) {
    envReplaySettingsResolved = true;
    envReplaySettings = resolveCrawlerReplaySettingsFromEnv();
  }
  return envReplaySettings;
};

export const createCrawlerNetworkClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkClient => {
  const settings = env === process.env ? cachedRecordingSettings() : resolveCrawlerRecordingSettingsFromEnv(env);
  const replaySettings = env === process.env ? cachedReplaySettings() : resolveCrawlerReplaySettingsFromEnv(env);
  if (settings && replaySettings) {
    throw new Error("Crawler recording and replay cannot be enabled at the same time");
  }
  if (replaySettings) {
    const replay = new CrawlerReplayNetworkClient({
      fixturesRoot: replaySettings.crawlerFixturesRoot,
      media: {
        manifestRoot: replaySettings.mediaManifestRoot,
        blobRoot: replaySettings.mediaBlobRoot,
        mockMediaRoot: replaySettings.mockMediaRoot,
        fallbackToMock: replaySettings.fallbackToMock,
      },
      network: options,
    });
    if (env === process.env) envReplay = replay;
    return replay;
  }
  if (!settings) return new NetworkClient(options);
  if (env === process.env) envSettings = settings;
  const recorder = new CrawlerRecordNetworkClient({ ...settings, network: options });
  envRecorder = recorder;
  return recorder;
};

export const attachCrawlerFixtureCaseId = <T extends { relativePath: string; caseId?: string }>(item: T): T => {
  if (!cachedRecordingSettings() && !cachedReplaySettings()) return item;
  const relativePath = item.relativePath.replaceAll("\\", "/");
  const caseId = crawlerCaseIdFromRelativePath(relativePath);
  const bound = fixtureCaseIdBindings.get(caseId);
  if (bound && bound !== relativePath) {
    throw new Error(`Fixture caseId '${caseId}' is already used by ${bound}, not ${relativePath}`);
  }
  fixtureCaseIdBindings.set(caseId, relativePath);
  return { ...item, caseId };
};

export const finalizeCrawlerFixtures = async (): Promise<void> => {
  try {
    await envRecorder?.finalize();
    await envReplay?.assertConsumed();
  } finally {
    fixtureCaseIdBindings.clear();
  }
};
