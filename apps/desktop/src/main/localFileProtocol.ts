import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toRootRelativePath } from "@mdcz/media-store";
import { findEnclosingMediaRoot } from "@mdcz/runtime/library";
import { LOCAL_FILE_SCHEME, parseLocalFileUrl, toLocalFileUrl } from "@mdcz/shared/mediaRef";
import { net, protocol } from "electron";

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
      return await net.fetch(pathToFileURL(filePath).href);
    } catch {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
  });
}
