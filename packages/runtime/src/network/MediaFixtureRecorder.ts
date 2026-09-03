import { cp, mkdir, rm } from "node:fs/promises";
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
import type { RawNetworkRequest, RawNetworkResponse } from "./NetworkClient";

interface MediaSession {
  caseId: string;
  nextSequence: number;
  interactions: MediaFixtureInteraction[];
}

export interface MediaFixtureRecorderOptions {
  stagingRoot: string;
  publishRoot: string;
  blobRoot: string;
}

export class MediaFixtureRecorder {
  private readonly sessions = new Map<string, MediaSession>();

  constructor(
    private readonly options: MediaFixtureRecorderOptions,
    private readonly redactor: CrawlerCredentialRedactor,
  ) {}

  async dispatch(
    context: { caseId: string },
    request: RawNetworkRequest,
    dispatch: () => Promise<RawNetworkResponse>,
  ): Promise<RawNetworkResponse> {
    const session = this.sessions.get(context.caseId) ?? { caseId: context.caseId, nextSequence: 0, interactions: [] };
    this.sessions.set(context.caseId, session);
    const sequence = ++session.nextSequence;

    let response: RawNetworkResponse;
    try {
      response = await dispatch();
    } catch (error) {
      session.interactions.push(await this.createInteraction(sequence, request, { error }));
      throw error;
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    session.interactions.push(await this.createInteraction(sequence, request, { response, bytes }));
    return response;
  }

  caseIds(): string[] {
    return [...this.sessions.keys()];
  }

  async finalize(): Promise<void> {
    for (const session of this.sessions.values()) {
      for (const interaction of session.interactions) this.redact(interaction);
      const directory = resolveMediaFixtureDirectory(this.options.stagingRoot, session.caseId);
      const manifest: MediaFixtureManifest = {
        schemaVersion: 1,
        caseId: session.caseId,
        interactions: session.interactions.sort((left, right) => left.sequence - right.sequence),
      };
      await mkdir(directory, { recursive: true });
      await atomicWriteFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      const destination = resolveMediaFixtureDirectory(this.options.publishRoot, session.caseId);
      await rm(destination, { recursive: true, force: true });
      await cp(directory, destination, { recursive: true });
    }
  }

  private async createInteraction(
    sequence: number,
    request: RawNetworkRequest,
    outcome: { response: RawNetworkResponse; bytes: Uint8Array } | { error: unknown },
  ): Promise<MediaFixtureInteraction> {
    this.redactor.observeUrl(request.url);
    this.redactor.observeHeaders(request.init.headers);
    const identity = await mediaRequestIdentity(request);
    if (identity.bodyBase64) {
      this.redactor.observeRequestBody(Buffer.from(identity.bodyBase64, "base64"), request.init.headers);
    }
    const interaction: MediaFixtureInteraction = { sequence, request: identity };

    if ("error" in outcome) {
      interaction.transportError = {
        name: outcome.error instanceof Error ? outcome.error.name : "Error",
        message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      };
      this.redact(interaction);
      return interaction;
    }

    this.redactor.observeHeaders(outcome.response.headers);
    const hash = sha256Hex(outcome.bytes);
    const blobPath = resolveMediaBlobPath(this.options.blobRoot, hash);
    await mkdir(path.dirname(blobPath), { recursive: true });
    await atomicWriteFile(blobPath, outcome.bytes);
    interaction.response = {
      status: outcome.response.status,
      statusText: outcome.response.statusText,
      url: outcome.response.url || request.url,
      headers: headersToCassetteList(outcome.response.headers),
      sha256: hash,
      byteLength: outcome.bytes.byteLength,
    };
    this.redact(interaction);
    return interaction;
  }

  private redact(interaction: MediaFixtureInteraction): void {
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
