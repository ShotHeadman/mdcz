import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { runtimeLoggerService } from "../shared";
import type { PublicationLibraryAsset } from "./outputLibrary";
import { toRootFileRef } from "./outputRefs";
import type { RegisteredPublicationContext } from "./types";
import { WriteOutput } from "./WriteOutput";

export interface RegisteredPublicationInput {
  operationId: string;
  operationType: "scrape" | "maintenance";
  mediaPaths?: string[];
  operations: Array<{
    kind: "write";
    owner: "movie" | "unmanaged";
    assetKind?: string;
    targetPath: string;
    content: { kind: "bytes"; data: Buffer } | { kind: "text"; data: string };
    replaceExisting: boolean;
  }>;
}

export const commitRegisteredPublication = async <TResult>(
  input: RegisteredPublicationInput,
  options: RegisteredPublicationContext & { commit?: () => TResult },
): Promise<TResult | undefined> => {
  if (new Set(input.operations.map((operation) => operation.owner)).size > 1)
    throw new Error("Tool publication must have one ownership scope");

  const media = await Promise.all(
    (input.mediaPaths ?? []).map(async (mediaPath) => {
      const observed = await stat(mediaPath);
      return { path: mediaPath, size: observed.size, mtimeMs: observed.mtimeMs };
    }),
  );
  const targets = input.operations.map((operation) => ({
    operation,
    ref: toRootFileRef(operation.targetPath, options.roots),
  }));
  const pathKey = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const protectedMedia = new Set(media.map((entry) => pathKey(entry.path)));
  if (input.operations.some((operation) => protectedMedia.has(pathKey(operation.targetPath))))
    throw new Error("Tool output cannot replace a protected source file");
  let writeAssets: (() => void) | undefined;

  if (options.outputs && input.operations.some((operation) => operation.owner === "unmanaged")) {
    const targetKeys = new Set(targets.map(({ ref }) => `${ref.rootId}\0${ref.relativePath}`));
    const occupied = options.outputs
      .publicationSnapshot({ paths: input.operations.map((operation) => operation.targetPath), includeOwners: true })
      .assets.some((asset) => targetKeys.has(`${asset.rootId}\0${asset.relativePath}`));
    if (occupied) throw new Error("Tool output is already owned by another movie");
  }

  if (options.outputs && input.operations.some((operation) => operation.owner === "movie")) {
    const snapshot = options.outputs.publicationSnapshot({
      paths: [...media.map((entry) => entry.path), ...input.operations.map((operation) => operation.targetPath)],
      includeOwners: true,
    });
    const refKey = (ref: { rootId: string; relativePath: string }) => `${ref.rootId}\0${ref.relativePath}`;
    const mediaKeys = new Set(media.map((entry) => refKey(toRootFileRef(entry.path, options.roots))));
    const targetKeys = new Set(targets.map(({ ref }) => refKey(ref)));
    const owners = new Set([
      ...snapshot.files.filter((file) => mediaKeys.has(refKey(file))).map((file) => file.itemId),
      ...snapshot.assets.filter((asset) => targetKeys.has(refKey(asset))).map((asset) => asset.itemId),
    ]);
    if (owners.size > 1) throw new Error("Tool output paths belong to different library movies");
    const movieId = [...owners][0];
    if (movieId) {
      if (!options.library) throw new Error("Registered publication requires scoped library writes");
      const library = options.library;
      const entry = await library.getEntryById(movieId);
      const changed: PublicationLibraryAsset[] = targets.flatMap(({ operation, ref }) =>
        operation.assetKind
          ? [
              {
                kind: operation.assetKind,
                uri: ref.relativePath,
                rootId: ref.rootId,
                relativePath: ref.relativePath,
                published: true,
              },
            ]
          : [],
      );
      if (changed.some((asset) => asset.kind === "strm" || asset.kind === "subtitle"))
        throw new Error("Registered tools only write movie assets");
      const assets = changed.length
        ? [
            ...entry.assets.filter(
              (asset) =>
                asset.fileId === null &&
                !changed.some(
                  (replacement) =>
                    replacement.kind === asset.kind &&
                    replacement.rootId === asset.rootId &&
                    replacement.relativePath === asset.relativePath,
                ),
            ),
            ...changed,
          ]
        : undefined;
      writeAssets = () => {
        library.writeEntry({ id: movieId, assets }, []);
      };
    }
  }

  const artifacts = [];
  for (const operation of input.operations) {
    if (!operation.replaceExisting) {
      const existing = await stat(operation.targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing) continue;
    }
    artifacts.push({ targetPath: operation.targetPath, data: operation.content.data });
  }
  const release = mediaPathOwnership.acquireAll(
    [...new Set(artifacts.map((artifact) => dirname(artifact.targetPath)))],
    input.operationId,
  );
  try {
    const published = await new WriteOutput().install(artifacts, {
      validate: async () => {
        for (const observed of media) {
          const current = await stat(observed.path);
          if (current.size !== observed.size || current.mtimeMs !== observed.mtimeMs)
            throw new Error(`Publication source changed before mutation: ${observed.path}`);
        }
      },
      commit: () => {
        writeAssets?.();
        return options.commit ? options.commit() : (undefined as TResult);
      },
    });
    for (const issue of published.cleanupIssues)
      runtimeLoggerService.getLogger("Publication").warn(`Publication cleanup failed: ${String(issue)}`);
    return published.value;
  } finally {
    release();
  }
};
