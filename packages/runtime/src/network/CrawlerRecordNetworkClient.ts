import { cp, mkdir, readFile, rm } from "node:fs/promises";
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
import { MediaFixtureRecorder } from "./MediaFixtureRecorder";
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
  network?: Omit<NetworkClientOptions, "rawDispatch">;
}

interface Session {
  website: Website;
  caseId: string;
  nextSequence: number;
  interactions: CrawlerCassetteInteraction[];
}

const sessionKey = (website: Website, caseId: string): string => `${website}\u0000${caseId}`;
const fixtureCaseIdBindings = new Map<string, string>();
const isMedia = (contentType: string | null): boolean => /^(image|video)\//u.test(contentType?.toLowerCase() ?? "");

export class CrawlerRecordNetworkClient extends NetworkClient {
  private readonly stagingRoot: string;
  private readonly publishRoot: string;
  private readonly mediaStagingRoot: string;
  private readonly redactor = new CrawlerCredentialRedactor();
  private readonly sessions = new Map<string, Session>();
  private readonly mediaRecorder: MediaFixtureRecorder;

  constructor(options: CrawlerRecordNetworkClientOptions) {
    super({
      ...options.network,
      rawDispatch: async (request, dispatch) => await this.dispatchAndRecord(request, dispatch),
    });
    this.stagingRoot = path.resolve(options.stagingRoot);
    this.publishRoot = path.resolve(options.publishRoot);
    this.mediaStagingRoot = path.resolve(options.mediaManifestStagingRoot ?? "test-results/recording/media-staging");
    this.mediaRecorder = new MediaFixtureRecorder(
      {
        stagingRoot: this.mediaStagingRoot,
        publishRoot: path.resolve(options.mediaManifestPublishRoot ?? "tests/fixtures/media"),
        blobRoot: path.resolve(options.mediaBlobRoot ?? "tests/fixtures/media"),
      },
      this.redactor,
    );
  }

  async finalize(): Promise<void> {
    if (this.sessions.size + this.mediaRecorder.caseIds().length === 0) {
      throw new Error("Recording did not capture any crawler or media interactions");
    }

    for (const session of this.sessions.values()) {
      await this.writeCassette(session);
      const source = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
      const destination = resolveCrawlerCassetteDirectory(this.publishRoot, session.website, session.caseId);
      await rm(destination, { recursive: true, force: true });
      await cp(source, destination, { recursive: true });
    }
    await this.mediaRecorder.finalize();
  }

  private async dispatchAndRecord(
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const context = getCrawlerFixtureContext();
    if (!context) {
      const media = getMediaFixtureContext();
      return media ? await this.mediaRecorder.dispatch(media, request, dispatch) : await dispatch();
    }

    const { website } = context.source;
    const { caseId } = context.item;
    let response: RawNetworkResponse;
    try {
      response = await dispatch();
    } catch (error) {
      const session = this.session(website, caseId);
      session.interactions.push(await this.createInteraction(session, ++session.nextSequence, request, { error }));
      throw error;
    }
    if (isMedia(response.headers.get("content-type"))) return response;
    const session = this.session(website, caseId);
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    session.interactions.push(
      await this.createInteraction(session, ++session.nextSequence, request, { response, bytes }),
    );
    return response;
  }

  private session(website: Website, caseId: string): Session {
    const key = sessionKey(website, caseId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const session = { website, caseId, nextSequence: 0, interactions: [] };
    this.sessions.set(key, session);
    return session;
  }

  private async createInteraction(
    session: Session,
    sequence: number,
    request: RawNetworkRequest,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): Promise<CrawlerCassetteInteraction> {
    this.redactor.observeUrl(request.url);
    this.redactor.observeHeaders(request.init.headers);
    const bodyBase64 = await rawRequestBodyToBase64(request.init.body);
    if (bodyBase64) this.redactor.observeRequestBody(Buffer.from(bodyBase64, "base64"), request.init.headers);

    const interaction: CrawlerCassetteInteraction = {
      sequence,
      request: {
        method: (request.init.method ?? "GET").toUpperCase(),
        url: request.url,
        headers: headersToCassetteList(request.init.headers),
        bodyBase64,
      },
    };
    if ("error" in outcome) {
      interaction.transportError = {
        name: outcome.error instanceof Error ? outcome.error.name : "Error",
        message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      };
      this.redact(interaction);
      return interaction;
    }

    this.redactor.observeHeaders(outcome.response.headers);
    const extension = responseBodyExtension(outcome.response.headers.get("content-type"));
    const bodyPath = path.posix.join("responses", `${String(sequence).padStart(3, "0")}${extension}`);
    const directory = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
    await mkdir(path.join(directory, "responses"), { recursive: true });
    await atomicWriteFile(path.join(directory, bodyPath), outcome.bytes);
    interaction.response = {
      status: outcome.response.status,
      statusText: outcome.response.statusText,
      url: outcome.response.url || request.url,
      headers: headersToCassetteList(outcome.response.headers),
      bodyPath,
      sha256: sha256Hex(outcome.bytes),
    };
    this.redact(interaction);
    return interaction;
  }

  private async writeCassette(session: Session): Promise<void> {
    const directory = resolveCrawlerCassetteDirectory(this.stagingRoot, session.website, session.caseId);
    for (const interaction of session.interactions) {
      this.redact(interaction);
      if (!interaction.response) continue;
      const bodyPath = path.join(directory, interaction.response.bodyPath);
      const original = await readFile(bodyPath);
      const redacted = this.redactor.redactBytes(original);
      if (!original.equals(redacted)) await atomicWriteFile(bodyPath, redacted);
      interaction.response.sha256 = sha256Hex(redacted);
      this.updateContentLength(interaction.response.headers, redacted.byteLength);
    }
    const cassette: CrawlerCassette = {
      schemaVersion: 1,
      caseId: session.caseId,
      website: session.website,
      credentialSeed: this.redactor.seed(),
      interactions: session.interactions.sort((left, right) => left.sequence - right.sequence),
    };
    await mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, "cassette.json"), `${JSON.stringify(cassette, null, 2)}\n`);
  }

  private redact(interaction: CrawlerCassetteInteraction): void {
    interaction.request.url = this.redactor.redactString(interaction.request.url);
    interaction.request.headers = this.redactHeaders(interaction.request.headers);
    if (interaction.request.bodyBase64) {
      const redacted = this.redactor.redactBytes(Buffer.from(interaction.request.bodyBase64, "base64"));
      interaction.request.bodyBase64 = Buffer.from(redacted).toString("base64");
      this.updateContentLength(interaction.request.headers, redacted.byteLength);
    }
    if (interaction.response) {
      interaction.response.url = this.redactor.redactString(interaction.response.url);
      interaction.response.headers = this.redactHeaders(interaction.response.headers);
    }
    if (interaction.transportError) {
      interaction.transportError.name = this.redactor.redactString(interaction.transportError.name);
      interaction.transportError.message = this.redactor.redactString(interaction.transportError.message);
    }
  }

  private redactHeaders(headers: Array<[string, string]>): Array<[string, string]> {
    return headers.map(([name, value]) => [name, this.redactor.redactString(value)]);
  }

  private updateContentLength(headers: Array<[string, string]>, length: number): void {
    const header = headers.find(([name]) => name === "content-length");
    if (header) header[1] = String(length);
  }
}

interface RecordingSettings {
  stagingRoot: string;
  publishRoot: string;
  mediaManifestStagingRoot: string;
  mediaManifestPublishRoot: string;
  mediaBlobRoot: string;
}

interface ReplaySettings {
  crawlerFixturesRoot: string;
  mediaManifestRoot: string;
  mediaBlobRoot: string;
}

let envRecorder: CrawlerRecordNetworkClient | undefined;
let envReplay: CrawlerReplayNetworkClient | undefined;

const enabled = (value: string | undefined): boolean => value === "1" || value === "true";

const recordingSettings = (env: NodeJS.ProcessEnv): RecordingSettings | undefined =>
  enabled(env.MDCZ_RECORD_CRAWLER)
    ? {
        stagingRoot: env.MDCZ_RECORD_STAGING || "test-results/recording/staging",
        publishRoot: env.MDCZ_RECORD_PUBLISH || "tests/fixtures/crawler",
        mediaManifestStagingRoot: env.MDCZ_RECORD_MEDIA_STAGING || "test-results/recording/media-staging",
        mediaManifestPublishRoot: env.MDCZ_RECORD_MEDIA_PUBLISH || "tests/fixtures/media",
        mediaBlobRoot: env.MDCZ_RECORD_MEDIA_BLOBS || "tests/fixtures/media",
      }
    : undefined;

const replaySettings = (env: NodeJS.ProcessEnv): ReplaySettings | undefined =>
  enabled(env.MDCZ_REPLAY_CRAWLER)
    ? {
        crawlerFixturesRoot: env.MDCZ_REPLAY_CRAWLER_FIXTURES || "tests/fixtures/crawler",
        mediaManifestRoot: env.MDCZ_REPLAY_MEDIA_MANIFESTS || "tests/fixtures/media",
        mediaBlobRoot: env.MDCZ_REPLAY_MEDIA_BLOBS || "tests/fixtures/media",
      }
    : undefined;

export const createCrawlerNetworkClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkClient => {
  const record = recordingSettings(env);
  const replay = replaySettings(env);
  if (record && replay) throw new Error("Crawler recording and replay cannot be enabled together");
  if (record) {
    const client = new CrawlerRecordNetworkClient({ ...record, network: options });
    if (env === process.env) envRecorder = client;
    return client;
  }
  if (replay) {
    const client = new CrawlerReplayNetworkClient({
      fixturesRoot: replay.crawlerFixturesRoot,
      media: { manifestRoot: replay.mediaManifestRoot, blobRoot: replay.mediaBlobRoot },
      network: options,
    });
    if (env === process.env) envReplay = client;
    return client;
  }
  return new NetworkClient(options);
};

export const attachCrawlerFixtureCaseId = <T extends { relativePath: string; caseId?: string }>(item: T): T => {
  if (!recordingSettings(process.env) && !replaySettings(process.env)) return item;
  const relativePath = item.relativePath.replaceAll("\\", "/");
  const caseId = crawlerCaseIdFromRelativePath(relativePath);
  const existing = fixtureCaseIdBindings.get(caseId);
  if (existing && existing !== relativePath) throw new Error(`Fixture caseId ${caseId} is also used by ${existing}`);
  fixtureCaseIdBindings.set(caseId, relativePath);
  return { ...item, caseId };
};

export const finalizeCrawlerFixtures = async (): Promise<void> => {
  await envRecorder?.finalize();
  await envReplay?.assertConsumed();
  fixtureCaseIdBindings.clear();
};
