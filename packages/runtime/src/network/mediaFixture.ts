import { access, constants, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertCrawlerFixturePathSegment, headersToCassetteList, sha256Hex } from "./crawlerCassette";

const headerListSchema = z.array(z.tuple([z.string(), z.string()]));
const requestSchema = z.object({
  method: z.string().min(1),
  url: z.url(),
  headers: headerListSchema,
  bodyBase64: z.string().nullable(),
});
const responseSchema = z.object({
  status: z.int().min(100).max(599),
  statusText: z.string(),
  url: z.url(),
  headers: headerListSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteLength: z.int().nonnegative(),
});
const transportErrorSchema = z.object({ name: z.string().min(1), message: z.string() });
const interactionSchema = z
  .object({
    sequence: z.int().positive(),
    request: requestSchema,
    response: responseSchema.optional(),
    transportError: transportErrorSchema.optional(),
  })
  .refine((interaction) => Boolean(interaction.response) !== Boolean(interaction.transportError), {
    message: "A media interaction must contain exactly one response or transportError",
  });

export const mediaFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  interactions: z.array(interactionSchema),
});

export type MediaFixtureManifest = z.infer<typeof mediaFixtureManifestSchema>;
export type MediaFixtureInteraction = MediaFixtureManifest["interactions"][number];

export interface LoadedMediaFixture {
  manifest: MediaFixtureManifest;
  responseBodies: ReadonlyMap<string, Uint8Array>;
}

export const resolveMediaFixtureDirectory = (manifestRoot: string, caseId: string): string => {
  assertCrawlerFixturePathSegment("Media fixture caseId", caseId);
  return path.resolve(manifestRoot, caseId);
};

export const resolveMediaBlobPath = (blobRoot: string, sha256: string): string => {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Invalid media fixture SHA-256: ${sha256}`);
  return path.resolve(blobRoot, "blobs", sha256);
};

export const DEFAULT_MOCK_MEDIA_ROOT = "tests/fixtures/mock-media";
export const MOCK_MEDIA_IMAGE_FILE = "sample.jpg";
export const MOCK_MEDIA_VIDEO_FILE = "sample.mp4";

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

export class MissingMediaBlobError extends Error {
  readonly caseId: string;
  readonly sha256: string;

  constructor(caseId: string, sha256: string) {
    super(
      `Media fixture blob ${sha256} is missing for ${caseId}. Mount private blobs at tests/fixtures/media/blobs/ or run pnpm fixtures:media:hydrate <path>. Unset MDCZ_MEDIA_REPLAY_STRICT to use built-in mock media.`,
    );
    this.name = "MissingMediaBlobError";
    this.caseId = caseId;
    this.sha256 = sha256;
  }
}

export const hasMediaBlob = async (blobRoot: string, sha256: string): Promise<boolean> => {
  try {
    await access(resolveMediaBlobPath(blobRoot, sha256), constants.R_OK);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
};

export const mockMediaKindFromContentType = (contentType: string | null): "image" | "video" => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("video/") ? "video" : "image";
};

export const loadMockMediaBytes = async (
  kind: "image" | "video",
  mockMediaRoot = DEFAULT_MOCK_MEDIA_ROOT,
): Promise<Uint8Array> => {
  const file = kind === "video" ? MOCK_MEDIA_VIDEO_FILE : MOCK_MEDIA_IMAGE_FILE;
  return new Uint8Array(await readFile(path.resolve(mockMediaRoot, file)));
};

export const loadMediaFixture = async (
  manifestRoot: string,
  blobRoot: string,
  caseId: string,
  options: { requireBlobs?: boolean } = {},
): Promise<LoadedMediaFixture> => {
  const requireBlobs = options.requireBlobs ?? true;
  const manifestPath = path.join(resolveMediaFixtureDirectory(manifestRoot, caseId), "manifest.json");
  const manifest = mediaFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.caseId !== caseId) {
    throw new Error(`Media fixture identity mismatch at ${manifestPath}: expected ${caseId}, got ${manifest.caseId}`);
  }

  const responseBodies = new Map<string, Uint8Array>();
  for (const [index, interaction] of manifest.interactions.entries()) {
    if (interaction.sequence !== index + 1) {
      throw new Error(`Media fixture sequence must be contiguous at ${caseId}: ${interaction.sequence}`);
    }
    const response = interaction.response;
    if (!response || responseBodies.has(response.sha256)) continue;
    if (!(await hasMediaBlob(blobRoot, response.sha256))) {
      if (!requireBlobs) continue;
      throw new MissingMediaBlobError(caseId, response.sha256);
    }
    const body = await readFile(resolveMediaBlobPath(blobRoot, response.sha256));
    if (body.byteLength !== response.byteLength) {
      throw new Error(
        `Media fixture byte length mismatch at ${caseId}/${response.sha256}: expected ${response.byteLength}, got ${body.byteLength}`,
      );
    }
    const actualHash = sha256Hex(body);
    if (actualHash !== response.sha256) {
      throw new Error(
        `Media fixture hash mismatch at ${caseId}/${response.sha256}: expected ${response.sha256}, got ${actualHash}`,
      );
    }
    responseBodies.set(response.sha256, body);
  }

  return { manifest, responseBodies };
};

export const mediaRequestIdentity = async (request: {
  url: string;
  init: { method?: string; headers: Headers; body?: unknown };
}): Promise<MediaFixtureInteraction["request"]> => {
  let bodyBase64: string | null = null;
  const body = request.init.body;
  if (typeof body === "string") bodyBase64 = Buffer.from(body).toString("base64");
  else if (body instanceof URLSearchParams) bodyBase64 = Buffer.from(body.toString()).toString("base64");
  else if (body instanceof ArrayBuffer) bodyBase64 = Buffer.from(body).toString("base64");
  else if (ArrayBuffer.isView(body)) {
    bodyBase64 = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("base64");
  } else if (body instanceof Blob) bodyBase64 = Buffer.from(await body.arrayBuffer()).toString("base64");
  else if (body !== undefined && body !== null) {
    throw new Error(`Media fixture does not support request body type ${body.constructor?.name ?? typeof body}`);
  }
  return {
    method: (request.init.method ?? "GET").toUpperCase(),
    url: request.url,
    headers: headersToCassetteList(request.init.headers),
    bodyBase64,
  };
};
