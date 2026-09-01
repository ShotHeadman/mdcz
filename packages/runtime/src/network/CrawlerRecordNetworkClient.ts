import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import type { Website } from "@mdcz/shared/enums";
import {
  type CrawlerCassette,
  type CrawlerCassetteInteraction,
  headersToCassetteList,
  rawRequestBodyToBase64,
  resolveCrawlerCassetteDirectory,
  responseBodyExtension,
  sha256Hex,
} from "./crawlerCassette";
import { CrawlerCredentialRedactor } from "./crawlerCredentials";
import { getCrawlerFixtureContext } from "./crawlerFixtureContext";
import { type CrawlerRecordingPlan, caseIdForRecordingPath, loadCrawlerRecordingPlan } from "./crawlerRecordingPlan";
import { type CrawlerRecordingObservation, publishCrawlerRecordingStaging } from "./crawlerRecordingPublish";
import {
  NetworkClient,
  type NetworkClientOptions,
  type RawNetworkRequest,
  type RawNetworkResponse,
} from "./NetworkClient";

export interface CrawlerRecordNetworkClientOptions {
  stagingRoot: string;
  publishRoot: string;
  plan: CrawlerRecordingPlan;
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

const paddedSequence = (sequence: number): string => String(sequence).padStart(3, "0");

const captureResponseBytes = async (response: RawNetworkResponse): Promise<Uint8Array> => {
  const cloned = response.clone();
  return new Uint8Array(await cloned.arrayBuffer());
};

export class CrawlerRecordNetworkClient extends NetworkClient {
  private readonly stagingRoot: string;
  private readonly publishRoot: string;
  private readonly plan: CrawlerRecordingPlan;
  private readonly redactor = new CrawlerCredentialRedactor();
  private readonly sessions = new Map<string, SessionState>();
  private readonly sequenceLocks = new Map<string, Promise<void>>();

  constructor(options: CrawlerRecordNetworkClientOptions) {
    super({
      ...options.network,
      rawDispatch: async (request, dispatch) => await this.dispatchAndRecord(request, dispatch),
    });
    this.stagingRoot = path.resolve(options.stagingRoot);
    this.publishRoot = path.resolve(options.publishRoot);
    this.plan = options.plan;
  }

  observations(): CrawlerRecordingObservation[] {
    return [...this.sessions.values()].map((session) => ({
      relativePath: session.relativePath,
      caseId: session.caseId,
      website: session.website,
    }));
  }

  async finalize(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async (session) => await session.writeChain));
    await publishCrawlerRecordingStaging({
      stagingRoot: this.stagingRoot,
      publishRoot: this.publishRoot,
      plan: this.plan,
      observations: this.observations(),
      redactor: this.redactor,
    });
  }

  private async dispatchAndRecord(
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const context = getCrawlerFixtureContext();
    if (!context) return await dispatch();

    const { website } = context.source;
    const { caseId, relativePath } = context.item;
    const plannedCaseId = caseIdForRecordingPath(this.plan, relativePath);
    if (plannedCaseId !== caseId) {
      throw new Error(`Recording plan caseId mismatch for ${relativePath}: expected ${plannedCaseId}, got ${caseId}`);
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
    if ("response" in outcome) this.redactor.observeHeaders(outcome.response.headers);

    const inspect = this.inspectionText(request, requestBodyBytes, outcome);
    for (const secret of this.redactor.secrets()) {
      if (inspect.includes(secret.real)) session.observedReals.add(secret.real);
    }

    const redactedUrl = this.redactor.redactString(request.url);
    const redactedRequestHeaders = this.redactHeaders(request.init.headers);
    const redactedRequestBody = requestBodyBytes ? this.redactor.redactBytes(requestBodyBytes) : null;
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
      const extension = responseBodyExtension(outcome.response.headers.get("content-type"));
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

interface ResolvedRecordingSettings {
  plan: CrawlerRecordingPlan;
  stagingRoot: string;
  publishRoot: string;
}

let envSettings: ResolvedRecordingSettings | undefined;
let envSettingsResolved = false;
let envRecorder: CrawlerRecordNetworkClient | undefined;

const envFlagEnabled = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const resolveCrawlerRecordingSettingsFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRecordingSettings | undefined => {
  if (!envFlagEnabled(env.MDCZ_RECORD_CRAWLER)) return undefined;
  const planPath = env.MDCZ_RECORD_PLAN?.trim();
  if (!planPath) throw new Error("MDCZ_RECORD_PLAN is required when MDCZ_RECORD_CRAWLER is enabled");
  return {
    plan: loadCrawlerRecordingPlan(planPath),
    stagingRoot: env.MDCZ_RECORD_STAGING?.trim() || DEFAULT_STAGING_ROOT,
    publishRoot: env.MDCZ_RECORD_PUBLISH?.trim() || DEFAULT_PUBLISH_ROOT,
  };
};

const cachedRecordingSettings = (): ResolvedRecordingSettings | undefined => {
  if (!envSettingsResolved) {
    envSettingsResolved = true;
    envSettings = resolveCrawlerRecordingSettingsFromEnv();
  }
  return envSettings;
};

export const createCrawlerNetworkClient = (
  options: NetworkClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): NetworkClient => {
  const settings = env === process.env ? cachedRecordingSettings() : resolveCrawlerRecordingSettingsFromEnv(env);
  if (!settings) return new NetworkClient(options);
  if (env === process.env) envSettings = settings;
  const recorder = new CrawlerRecordNetworkClient({ ...settings, network: options });
  envRecorder = recorder;
  return recorder;
};

export const attachCrawlerRecordingCaseId = <T extends { relativePath: string; caseId?: string }>(item: T): T => {
  const settings = cachedRecordingSettings();
  if (!settings) return item;
  const caseId = caseIdForRecordingPath(settings.plan, item.relativePath);
  if (!caseId) throw new Error(`Recording plan has no caseId for ${item.relativePath}`);
  return { ...item, caseId };
};

export const finalizeCrawlerRecording = async (): Promise<void> => {
  await envRecorder?.finalize();
};
