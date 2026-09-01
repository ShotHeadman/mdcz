import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { findEnclosingMediaRoot, toRootRelativePath } from "@mdcz/media-store";
import { LOCAL_FILE_SCHEME, parseLocalFileUrl, toLocalFileUrl } from "@mdcz/shared/mediaRef";
import { protocol } from "electron";

export { LOCAL_FILE_SCHEME };

export class LocalFileProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalFileProtocolError";
  }
}

export interface LocalFileRoot {
  id: string;
  hostPath: string;
}

export interface LocalFileProtocolDependencies {
  getRoot: (rootId: string) => Promise<LocalFileRoot | null>;
}

interface ByteRange {
  start: number;
  end: number;
}

const FILE_CHUNK_SIZE = 64 * 1024;
const LOCAL_FILE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

const parseByteRange = (value: string | null, size: number): ByteRange | null | undefined => {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
  if (!match || size === 0) return null;

  const [, startValue = "", endValue = ""] = match;
  if (!startValue && !endValue) return null;
  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startValue);
  const requestedEnd = endValue ? Number(endValue) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
};

const createFileBody = async (filePath: string, range: ByteRange): Promise<ReadableStream<Uint8Array>> => {
  const file = await open(filePath, "r");
  let position = range.start;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await file.close();
  };

  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (closed) return;
      try {
        const remaining = range.end - position + 1;
        if (remaining <= 0) {
          controller.close();
          await close();
          return;
        }
        const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK_SIZE, remaining));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
          controller.close();
          await close();
          return;
        }
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
        if (position > range.end) {
          controller.close();
          await close();
        }
      } catch (error) {
        if (!closed) controller.error(error);
        await close();
      }
    },
    cancel: close,
  });
};

export const createLocalFileResponse = async (filePath: string, request: Request): Promise<Response> => {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const { size } = await stat(filePath);
  const range = parseByteRange(request.headers.get("range"), size);
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": LOCAL_FILE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
  });
  if (range === null) {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const selectedRange = range ?? { start: 0, end: size - 1 };
  headers.set("content-length", String(Math.max(0, selectedRange.end - selectedRange.start + 1)));
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  const body = method === "HEAD" || size === 0 ? null : await createFileBody(filePath, selectedRange);
  return new Response(body, { status: range ? 206 : 200, headers });
};

const assertCanonicalContainment = (canonicalRoot: string, canonicalPath: string): void => {
  const relative = path.relative(canonicalRoot, canonicalPath);
  if (relative === "") {
    throw new LocalFileProtocolError("Asset path is a directory");
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LocalFileProtocolError("Asset path is outside the registered root");
  }
};

export const localFileUrlForHostPath = (hostPath: string, roots: readonly LocalFileRoot[]): string | undefined => {
  const root = findEnclosingMediaRoot(hostPath, roots);
  if (!root) {
    return undefined;
  }
  try {
    return toLocalFileUrl({
      rootId: root.id,
      relativePath: toRootRelativePath(root, hostPath),
    });
  } catch {
    return undefined;
  }
};

export const resolveLocalFileRequest = async (
  requestUrl: string,
  getRoot: LocalFileProtocolDependencies["getRoot"],
): Promise<string> => {
  const ref = parseLocalFileUrl(requestUrl);
  const root = await getRoot(ref.rootId);
  if (!root) {
    throw new LocalFileProtocolError("Asset path is outside every registered root");
  }

  const resolvedPath = path.resolve(root.hostPath, ref.relativePath);
  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    canonicalRoot = await realpath(root.hostPath);
    canonicalPath = await realpath(resolvedPath);
  } catch {
    throw new LocalFileProtocolError("Asset path does not exist");
  }

  assertCanonicalContainment(canonicalRoot, canonicalPath);

  const stats = await stat(canonicalPath);
  if (stats.isDirectory()) {
    throw new LocalFileProtocolError("Asset path is a directory");
  }
  if (!stats.isFile()) {
    throw new LocalFileProtocolError("Asset path is not a file");
  }

  return canonicalPath;
};

export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

export function registerLocalFileHandler(dependencies: LocalFileProtocolDependencies): void {
  protocol.handle(LOCAL_FILE_SCHEME, async (request) => {
    try {
      const filePath = await resolveLocalFileRequest(request.url, dependencies.getRoot);
      return await createLocalFileResponse(filePath, request);
    } catch {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
  });
}
