import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import { FAILURE_REASONS } from "@mdcz/shared/siteResults";
import { z } from "zod";
import type { RawNetworkRequest } from "./NetworkClient";

export const SHARED_NETWORK_FIXTURE_CASE_ID = "shared";

const headerListSchema = z.array(z.tuple([z.string(), z.string()]));
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const requestSchema = z.object({
  method: z.string().min(1),
  url: z.url(),
  bodyBase64: z.string().nullable(),
});
const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1),
    sha256: sha256Schema,
    byteLength: z.int().nonnegative(),
  }),
  // Images keep only their shape; replay generates stand-ins of the same size.
  z.object({
    kind: z.literal("image"),
    sha256: sha256Schema,
    byteLength: z.int().nonnegative(),
    width: z.int().positive().optional(),
    height: z.int().positive().optional(),
  }),
  // Videos keep nothing; replay serves one stock video for all of them.
  z.object({ kind: z.literal("video") }),
]);
const responseSchema = z.object({
  status: z.int().min(100).max(599),
  statusText: z.string(),
  url: z.url(),
  headers: headerListSchema,
  body: bodySchema,
});
const interactionSchema = z
  .object({
    channel: z.string().min(1),
    sequence: z.int().positive(),
    request: requestSchema,
    response: responseSchema.optional(),
    transportError: z.object({ name: z.string().min(1), message: z.string() }).optional(),
  })
  .refine((interaction) => Boolean(interaction.response) !== Boolean(interaction.transportError), {
    message: "An interaction must contain exactly one response or transportError",
  });

export const networkFixtureManifestSchema = z.object({
  schemaVersion: z.literal(2),
  caseId: z.string().min(1),
  credentialSeed: z.object({
    cookies: z.record(z.string(), z.string()),
    tokens: z.record(z.string(), z.string()),
  }),
  /** Sites whose outcome depended on the recording network; replay fails them with the same reason. */
  skippedSites: z.array(z.object({ site: z.enum(Website), reason: z.enum(FAILURE_REASONS) })),
  interactions: z.array(interactionSchema),
});

export type NetworkFixtureManifest = z.infer<typeof networkFixtureManifestSchema>;
export type NetworkFixtureInteraction = NetworkFixtureManifest["interactions"][number];
export type NetworkFixtureRequest = NetworkFixtureInteraction["request"];
export type NetworkFixtureCredentialSeed = NetworkFixtureManifest["credentialSeed"];

// Cache-busting parameters that change on every request without changing the response.
const VOLATILE_QUERY_PARAMS: Record<string, readonly string[]> = {
  "raw.githubusercontent.com": ["t"],
};

/** Replay matches on method, this URL form, and body; headers never take part. */
export const normalizeFixtureUrl = (value: string): string => {
  const url = new URL(value);
  for (const name of VOLATILE_QUERY_PARAMS[url.hostname] ?? []) url.searchParams.delete(name);
  url.searchParams.sort();
  return url.toString();
};

export const resolveNetworkFixtureDirectory = (fixturesRoot: string, caseId: string): string =>
  path.resolve(fixturesRoot, caseId);

export const responseBodyExtension = (contentType: string | null): string => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.includes("html")) return ".html";
  if (type.includes("json")) return ".json";
  if (type.startsWith("text/")) return ".txt";
  return ".bin";
};

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const headersToFixtureList = (headers: Headers): Array<[string, string]> => {
  const entries = [...headers]
    .filter(([name]) => name.toLowerCase() !== "set-cookie")
    .map(([name, value]) => [name.toLowerCase(), value] as [string, string]);
  const setCookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  entries.push(...setCookies.map((value) => ["set-cookie", value] as [string, string]));
  return entries.sort(([leftName, leftValue], [rightName, rightValue]) => {
    const left = `${leftName}\u0000${leftValue}`;
    const right = `${rightName}\u0000${rightValue}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
};

export const rawRequestBodyToBase64 = async (body: unknown): Promise<string | null> => {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return Buffer.from(body).toString("base64");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString()).toString("base64");
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("base64");
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("base64");
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer()).toString("base64");
  throw new Error(`Network fixture does not support request body type ${body.constructor?.name ?? typeof body}`);
};

export const networkRequestIdentity = async (request: RawNetworkRequest): Promise<NetworkFixtureRequest> => ({
  method: (request.init.method ?? "GET").toUpperCase(),
  url: request.url,
  bodyBase64: await rawRequestBodyToBase64(request.init.body),
});

export const loadNetworkFixture = async (fixturesRoot: string, caseId: string): Promise<NetworkFixtureManifest> => {
  const manifestPath = path.join(resolveNetworkFixtureDirectory(fixturesRoot, caseId), "manifest.json");
  const manifest = networkFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.caseId !== caseId) {
    throw new Error(`Network fixture identity mismatch at ${manifestPath}: expected ${caseId}, got ${manifest.caseId}`);
  }
  const nextSequence = new Map<string, number>();
  for (const interaction of manifest.interactions) {
    const expected = (nextSequence.get(interaction.channel) ?? 0) + 1;
    if (interaction.sequence !== expected) {
      throw new Error(
        `Network fixture sequence must be contiguous at ${caseId}/${interaction.channel}: ${interaction.sequence}`,
      );
    }
    nextSequence.set(interaction.channel, expected);
  }
  return manifest;
};
