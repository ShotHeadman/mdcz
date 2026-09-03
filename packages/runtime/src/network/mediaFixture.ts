import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { headersToCassetteList, rawRequestBodyToBase64, sha256Hex } from "./crawlerCassette";

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
  return path.resolve(manifestRoot, caseId);
};

export const resolveMediaBlobPath = (blobRoot: string, sha256: string): string => {
  return path.resolve(blobRoot, "blobs", sha256);
};

const MOCK_MEDIA_ROOT = "tests/fixtures/mock-media";

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

export const loadMockMediaBytes = async (kind: "image" | "video"): Promise<Uint8Array> => {
  const file = kind === "video" ? "sample.mp4" : "sample.jpg";
  return new Uint8Array(await readFile(path.resolve(MOCK_MEDIA_ROOT, file)));
};

export const loadMediaFixture = async (
  manifestRoot: string,
  blobRoot: string,
  caseId: string,
): Promise<LoadedMediaFixture> => {
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
    let body: Buffer;
    try {
      body = await readFile(resolveMediaBlobPath(blobRoot, response.sha256));
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
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
  return {
    method: (request.init.method ?? "GET").toUpperCase(),
    url: request.url,
    headers: headersToCassetteList(request.init.headers),
    bodyBase64: await rawRequestBodyToBase64(request.init.body),
  };
};
