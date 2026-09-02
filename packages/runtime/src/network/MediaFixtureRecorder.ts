import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@mdcz/media-store";
import { headersToCassetteList, sha256Hex } from "./crawlerCassette";
import type { CrawlerCredentialRedactor } from "./crawlerCredentials";
import {
  type MediaFixtureInteraction,
  type MediaFixtureManifest,
  mediaRequestIdentity,
  resolveMediaBlobPath,
  resolveMediaFixtureDirectory,
} from "./mediaFixture";
import { publishMediaRecordingStaging, validateMediaRecordingStaging } from "./mediaRecordingPublish";
import type { RawNetworkRequest, RawNetworkResponse } from "./NetworkClient";

interface MediaSession {
  caseId: string;
  relativePath: string;
  nextSequence: number;
  interactions: Map<number, MediaFixtureInteraction>;
  writeChain: Promise<void>;
}

export interface MediaFixtureRecorderOptions {
  stagingRoot: string;
  publishRoot: string;
  blobRoot: string;
}

export class MediaFixtureRecorder {
  private readonly sessions = new Map<string, MediaSession>();
  private readonly sequenceLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly options: MediaFixtureRecorderOptions,
    private readonly redactor: CrawlerCredentialRedactor,
  ) {}

  async dispatch(
    context: { caseId: string; relativePath: string },
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const sequence = await this.allocateSequence(context.caseId, context.relativePath);
    try {
      const response = await dispatch();
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      await this.record(context.caseId, sequence, request, { response, bytes });
      return response;
    } catch (error) {
      await this.record(context.caseId, sequence, request, { error });
      throw error;
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async (session) => await session.writeChain));
    await Promise.all([...this.sessions.values()].map(async (session) => await this.refreshRedactions(session)));
  }

  caseIds(): string[] {
    return [...this.sessions.keys()];
  }

  async validate(): Promise<void> {
    await validateMediaRecordingStaging({
      manifestRoot: this.options.stagingRoot,
      blobRoot: this.options.blobRoot,
      expectedCaseIds: [...this.sessions.keys()],
      redactor: this.redactor,
    });
  }

  async publish(): Promise<void> {
    await publishMediaRecordingStaging({
      stagingRoot: this.options.stagingRoot,
      publishRoot: this.options.publishRoot,
      blobRoot: this.options.blobRoot,
      expectedCaseIds: [...this.sessions.keys()],
      redactor: this.redactor,
    });
  }

  private async allocateSequence(caseId: string, relativePath: string): Promise<number> {
    const previous = this.sequenceLocks.get(caseId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sequenceLocks.set(
      caseId,
      previous.then(() => current),
    );
    await previous;
    try {
      let session = this.sessions.get(caseId);
      if (session && session.relativePath !== relativePath) {
        throw new Error(
          `Media fixture caseId ${caseId} is already bound to ${session.relativePath}, not ${relativePath}`,
        );
      }
      if (!session) {
        session = {
          caseId,
          relativePath,
          nextSequence: 0,
          interactions: new Map(),
          writeChain: Promise.resolve(),
        };
        this.sessions.set(caseId, session);
      }
      session.nextSequence += 1;
      return session.nextSequence;
    } finally {
      release();
    }
  }

  private async record(
    caseId: string,
    sequence: number,
    request: RawNetworkRequest,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): Promise<void> {
    const session = this.sessions.get(caseId);
    if (!session) throw new Error(`Media recording session is missing for ${caseId}`);

    this.redactor.observeUrl(request.url);
    this.redactor.observeHeaders(request.init.headers);
    if ("response" in outcome) this.redactor.observeHeaders(outcome.response.headers);
    const identity = await mediaRequestIdentity(request);
    const requestBody = identity.bodyBase64 ? Buffer.from(identity.bodyBase64, "base64") : null;
    if (requestBody) this.redactor.observeRequestBody(requestBody, request.init.headers);
    const redactedBody = requestBody ? this.redactor.redactBytes(requestBody) : null;
    const redactedHeaders = this.redactHeaders(request.init.headers);
    if (
      requestBody &&
      redactedBody &&
      requestBody.byteLength !== redactedBody.byteLength &&
      redactedHeaders.has("content-length")
    ) {
      redactedHeaders.set("content-length", String(redactedBody.byteLength));
    }
    const interaction: MediaFixtureInteraction = {
      sequence,
      request: {
        ...identity,
        url: this.redactor.redactString(identity.url),
        headers: headersToCassetteList(redactedHeaders),
        bodyBase64: redactedBody ? Buffer.from(redactedBody).toString("base64") : null,
      },
    };

    if ("error" in outcome) {
      interaction.transportError = {
        name: this.redactor.redactString(outcome.error instanceof Error ? outcome.error.name : "Error"),
        message: this.redactor.redactString(
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
        ),
      };
    } else {
      const hash = sha256Hex(outcome.bytes);
      const blobPath = resolveMediaBlobPath(this.options.blobRoot, hash);
      await mkdir(path.dirname(blobPath), { recursive: true });
      await atomicWriteFile(blobPath, outcome.bytes);
      interaction.response = {
        status: outcome.response.status,
        statusText: outcome.response.statusText,
        url: this.redactor.redactString(outcome.response.url || request.url),
        headers: headersToCassetteList(this.redactHeaders(outcome.response.headers)),
        sha256: hash,
        byteLength: outcome.bytes.byteLength,
      };
    }

    session.interactions.set(sequence, interaction);
    session.writeChain = session.writeChain.then(async () => await this.writeManifest(session));
    await session.writeChain;
  }

  private redactHeaders(headers: Headers): Headers {
    const redacted = new Headers();
    for (const [name, value] of headersToCassetteList(headers)) {
      redacted.append(name, this.redactor.redactString(value));
    }
    return redacted;
  }

  private async refreshRedactions(session: MediaSession): Promise<void> {
    for (const interaction of session.interactions.values()) {
      interaction.request.url = this.redactor.redactString(interaction.request.url);
      const requestHeaders = this.redactHeaders(new Headers(interaction.request.headers));
      if (interaction.request.bodyBase64) {
        const body = Buffer.from(interaction.request.bodyBase64, "base64");
        const redacted = this.redactor.redactBytes(body);
        interaction.request.bodyBase64 = Buffer.from(redacted).toString("base64");
        if (body.byteLength !== redacted.byteLength && requestHeaders.has("content-length")) {
          requestHeaders.set("content-length", String(redacted.byteLength));
        }
      }
      interaction.request.headers = headersToCassetteList(requestHeaders);
      if (interaction.response) {
        interaction.response.url = this.redactor.redactString(interaction.response.url);
        interaction.response.headers = headersToCassetteList(
          this.redactHeaders(new Headers(interaction.response.headers)),
        );
      }
      if (interaction.transportError) {
        interaction.transportError.name = this.redactor.redactString(interaction.transportError.name);
        interaction.transportError.message = this.redactor.redactString(interaction.transportError.message);
      }
    }
    await this.writeManifest(session);
  }

  private async writeManifest(session: MediaSession): Promise<void> {
    const manifest: MediaFixtureManifest = {
      schemaVersion: 1,
      caseId: session.caseId,
      interactions: [...session.interactions.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, interaction]) => interaction),
    };
    const directory = resolveMediaFixtureDirectory(this.options.stagingRoot, session.caseId);
    await mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
