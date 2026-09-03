import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import { z } from "zod";

const headerListSchema = z.array(z.tuple([z.string(), z.string()]));

const requestSchema = z.object({
  method: z.string().min(1),
  url: z.url(),
  headers: headerListSchema,
  bodyBase64: z.string().nullable(),
});

const responseSchema = z.object({
  status: z.int().min(200).max(599),
  statusText: z.string(),
  url: z.url(),
  headers: headerListSchema,
  bodyPath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

const transportErrorSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
});

const interactionSchema = z
  .object({
    sequence: z.int().positive(),
    request: requestSchema,
    response: responseSchema.optional(),
    transportError: transportErrorSchema.optional(),
  })
  .refine((interaction) => Boolean(interaction.response) !== Boolean(interaction.transportError), {
    message: "An interaction must contain exactly one response or transportError",
  });

export const crawlerCassetteSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  website: z.enum(Website),
  credentialSeed: z.object({
    cookies: z.record(z.string(), z.string()),
    tokens: z.record(z.string(), z.string()),
  }),
  interactions: z.array(interactionSchema),
});

export type CrawlerCassette = z.infer<typeof crawlerCassetteSchema>;
export type CrawlerCassetteInteraction = CrawlerCassette["interactions"][number];
export type CrawlerCredentialSeed = CrawlerCassette["credentialSeed"];

export interface LoadedCrawlerCassette {
  cassette: CrawlerCassette;
  responseBodies: ReadonlyMap<number, Uint8Array>;
}

export const crawlerCaseIdFromRelativePath = (relativePath: string): string => {
  const base = path.posix.basename(relativePath.replaceAll("\\", "/").trim());
  const stem = base.includes(".") ? base.replace(/\.[^.]+$/u, "") : base;
  const caseId = stem
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^[._-]+|[._-]+$/gu, "")
    .replaceAll(/-{2,}/gu, "-");
  if (!caseId) throw new Error(`Cannot derive crawler caseId from ${relativePath}`);
  return caseId;
};

export const resolveCrawlerCassetteDirectory = (fixturesRoot: string, website: Website, caseId: string): string => {
  return path.resolve(fixturesRoot, website, caseId);
};

export const responseBodyExtension = (contentType: string | null): string => {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.includes("html")) return ".html";
  if (type.includes("json")) return ".json";
  if (type.startsWith("text/")) return ".txt";
  return ".bin";
};

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const headersToCassetteList = (headers: Headers): Array<[string, string]> => {
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
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("base64");
  }
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer()).toString("base64");
  throw new Error(`Crawler cassette does not support request body type ${body.constructor?.name ?? typeof body}`);
};

export const loadCrawlerCassette = async (
  fixturesRoot: string,
  website: Website,
  caseId: string,
): Promise<LoadedCrawlerCassette> => {
  const directory = resolveCrawlerCassetteDirectory(fixturesRoot, website, caseId);
  const cassettePath = path.join(directory, "cassette.json");
  const cassette = crawlerCassetteSchema.parse(JSON.parse(await readFile(cassettePath, "utf8")));

  if (cassette.website !== website || cassette.caseId !== caseId) {
    throw new Error(
      `Crawler cassette identity mismatch at ${cassettePath}: expected ${website}/${caseId}, got ${cassette.website}/${cassette.caseId}`,
    );
  }

  const responseBodies = new Map<number, Uint8Array>();
  for (const [index, interaction] of cassette.interactions.entries()) {
    if (interaction.sequence !== index + 1) {
      throw new Error(`Crawler cassette sequence must be contiguous at ${website}/${caseId}: ${interaction.sequence}`);
    }
    if (!interaction.response) continue;
    const body = await readFile(path.join(directory, interaction.response.bodyPath));
    const actualHash = sha256Hex(body);
    if (actualHash !== interaction.response.sha256) {
      throw new Error(
        `Crawler cassette response hash mismatch at ${website}/${caseId}/${interaction.response.bodyPath}: expected ${interaction.response.sha256}, got ${actualHash}`,
      );
    }
    responseBodies.set(interaction.sequence, body);
  }

  return { cassette, responseBodies };
};
