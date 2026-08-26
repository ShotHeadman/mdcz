import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  normalizeRootRelativePath,
  resolveRootRelativePath,
  StorageError,
  statRootPath,
  storageErrorCodes,
} from "@mdcz/media-store";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import sharp from "sharp";
import type { ServerServices } from "../services";
import { getBearerToken } from "./auth";

const imageContentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const sharpFormats: Record<string, keyof sharp.FormatEnum> = {
  ".avif": "avif",
  ".gif": "gif",
  ".jpeg": "jpeg",
  ".jpg": "jpeg",
  ".png": "png",
  ".webp": "webp",
};

const pendingVariants = new Map<string, Promise<void>>();
const ASSET_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const ASSET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cacheCleanupState = new Map<string, { lastRun: number; promise: Promise<void> | null }>();

const cleanupAssetCache = async (cacheDirectory: string): Promise<void> => {
  let entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
  try {
    entries = await Promise.all(
      (await readdir(cacheDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(cacheDirectory, entry.name);
          const file = await stat(filePath);
          return { path: filePath, size: file.size, mtimeMs: file.mtimeMs };
        }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    return;
  }

  const cutoff = Date.now() - ASSET_CACHE_TTL_MS;
  const retained = entries
    .filter((entry) => entry.mtimeMs >= cutoff)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  let total = 0;
  for (const entry of retained) {
    if (total + entry.size > ASSET_CACHE_MAX_BYTES) {
      await unlink(entry.path).catch(() => undefined);
      continue;
    }
    total += entry.size;
  }
  for (const entry of entries.filter((candidate) => candidate.mtimeMs < cutoff)) {
    await unlink(entry.path).catch(() => undefined);
  }
};

const scheduleCacheCleanup = (cacheDirectory: string): void => {
  const state = cacheCleanupState.get(cacheDirectory) ?? { lastRun: 0, promise: null };
  if (Date.now() - state.lastRun < 5 * 60 * 1000 || state.promise) return;
  state.lastRun = Date.now();
  state.promise = cleanupAssetCache(cacheDirectory)
    .catch(() => undefined)
    .finally(() => {
      state.promise = null;
    });
  cacheCleanupState.set(cacheDirectory, state);
};

const toStatusCode = (error: unknown): number => {
  if (error instanceof StorageError) {
    if (error.code === storageErrorCodes.MissingPath) {
      return 404;
    }
    if (error.code === storageErrorCodes.PermissionDenied) {
      return 403;
    }
    if (error.code === storageErrorCodes.OutsideRoot) {
      return 400;
    }
    if (error.code === storageErrorCodes.UnsupportedOperation) {
      return 400;
    }
  }
  return 500;
};

const sendError = (reply: FastifyReply, statusCode: number, message: string): FastifyReply =>
  reply.code(statusCode).send({ error: { message } });

const parseRevision = (query: Record<string, unknown>): string =>
  typeof query.revision === "string" ? query.revision.slice(0, 128) : "";

const parseVariant = (
  query: Record<string, unknown>,
  sourceExtension: string,
): { extension: string; format: keyof sharp.FormatEnum; revision: string; width: number } | null => {
  if (query.w === undefined && query.format === undefined) {
    return null;
  }
  const width = Number(query.w);
  if (!Number.isInteger(width) || width < 64 || width > 1600) {
    throw new StorageError(storageErrorCodes.UnsupportedOperation, "Asset width must be an integer from 64 to 1600");
  }
  const requestedFormat = typeof query.format === "string" ? query.format.trim().toLowerCase() : "source";
  if (!["source", "webp", "avif"].includes(requestedFormat)) {
    throw new StorageError(storageErrorCodes.UnsupportedOperation, "Unsupported asset format");
  }
  const format = requestedFormat === "source" ? sharpFormats[sourceExtension] : (requestedFormat as "avif" | "webp");
  if (!format) {
    throw new StorageError(storageErrorCodes.UnsupportedOperation, "Unsupported source image format");
  }
  const extension = requestedFormat === "source" ? sourceExtension : `.${requestedFormat}`;
  const revision = parseRevision(query);
  return { extension, format, revision, width };
};

const variantCacheKey = (input: {
  format: string;
  modifiedAt: Date;
  relativePath: string;
  revision: string;
  rootId: string;
  size: number;
  width: number;
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        format: input.format,
        modifiedAt: input.modifiedAt.getTime(),
        relativePath: input.relativePath,
        revision: input.revision,
        rootId: input.rootId,
        size: input.size,
        width: input.width,
      }),
    )
    .digest("hex");

const ensureVariant = async (
  sourcePath: string,
  cachePath: string,
  width: number,
  format: keyof sharp.FormatEnum,
): Promise<void> => {
  try {
    await stat(cachePath);
    return;
  } catch {}

  const existing = pendingVariants.get(cachePath);
  if (existing) {
    return await existing;
  }
  const pending = (async () => {
    await mkdir(path.dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await sharp(sourcePath).resize({ width, withoutEnlargement: true }).toFormat(format).toFile(tempPath);
      await rename(tempPath, cachePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  })();
  pendingVariants.set(cachePath, pending);
  try {
    await pending;
  } finally {
    pendingVariants.delete(cachePath);
  }
};

const setRepresentationHeaders = (
  request: FastifyRequest,
  reply: FastifyReply,
  input: { contentType: string; etag: string; modifiedAt: Date },
): boolean => {
  reply.type(input.contentType);
  reply.header("cache-control", "private, max-age=3600");
  reply.header("etag", input.etag);
  reply.header("last-modified", input.modifiedAt.toUTCString());
  const ifNoneMatch = request.headers["if-none-match"];
  const etagMatches =
    typeof ifNoneMatch === "string" &&
    ifNoneMatch
      .split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate.replace(/^W\//iu, "") === input.etag);
  const ifModifiedSince = request.headers["if-modified-since"];
  const modifiedSince = typeof ifModifiedSince === "string" ? Date.parse(ifModifiedSince) : Number.NaN;
  const isNotModifiedSince =
    ifNoneMatch === undefined &&
    Number.isFinite(modifiedSince) &&
    Math.floor(input.modifiedAt.getTime() / 1000) <= Math.floor(modifiedSince / 1000);
  if (etagMatches || isNotModifiedSince) {
    reply.code(304).send();
    return true;
  }
  return false;
};

export const registerLibraryAssets = (fastify: FastifyInstance, services: ServerServices): void => {
  const cacheDirectory = path.join(services.config.runtimePaths.dataDir, "library-asset-cache");
  scheduleCacheCleanup(cacheDirectory);
  fastify.get("/api/library/assets/:rootId/*", async (request: FastifyRequest, reply) => {
    try {
      services.auth.assertAuthenticated(getBearerToken(request));
    } catch (error) {
      return sendError(reply, 401, error instanceof Error ? error.message : "Authentication required");
    }

    const params = request.params as { "*": string; rootId: string };
    let relativePath: string;
    try {
      relativePath = normalizeRootRelativePath(params["*"]);
    } catch (error) {
      return sendError(reply, toStatusCode(error), error instanceof Error ? error.message : "Invalid asset path");
    }

    const sourceExtension = path.extname(relativePath).toLowerCase();
    const sourceContentType = imageContentTypes[sourceExtension];
    if (!sourceContentType) {
      return sendError(reply, 415, "Unsupported library asset type");
    }

    try {
      const root = await services.mediaRoots.getActiveRoot(params.rootId);
      const source = await statRootPath(root, relativePath);
      if (source.kind !== "file") {
        return sendError(reply, 415, "Library asset is not a file");
      }
      const query = request.query as Record<string, unknown>;
      const variant = parseVariant(query, sourceExtension);
      const sourcePath = resolveRootRelativePath(root, relativePath);
      if (!variant) {
        const etag = `"${variantCacheKey({
          format: sourceExtension,
          modifiedAt: source.modifiedAt,
          relativePath,
          revision: parseRevision(query),
          rootId: root.id,
          size: source.size,
          width: 0,
        })}"`;
        if (
          setRepresentationHeaders(request, reply, {
            contentType: sourceContentType,
            etag,
            modifiedAt: source.modifiedAt,
          })
        ) {
          return reply;
        }
        return reply.send(createReadStream(sourcePath));
      }

      const key = variantCacheKey({
        format: variant.format,
        modifiedAt: source.modifiedAt,
        relativePath,
        revision: variant.revision,
        rootId: root.id,
        size: source.size,
        width: variant.width,
      });
      const cachePath = path.join(
        services.config.runtimePaths.dataDir,
        "library-asset-cache",
        `${key}${variant.extension}`,
      );
      await ensureVariant(sourcePath, cachePath, variant.width, variant.format);
      scheduleCacheCleanup(cacheDirectory);
      const etag = `"${key}"`;
      const contentType = imageContentTypes[variant.extension] ?? sourceContentType;
      if (setRepresentationHeaders(request, reply, { contentType, etag, modifiedAt: source.modifiedAt })) {
        return reply;
      }
      return reply.send(createReadStream(cachePath));
    } catch (error) {
      return sendError(reply, toStatusCode(error), error instanceof Error ? error.message : "Failed to read asset");
    }
  });
};
