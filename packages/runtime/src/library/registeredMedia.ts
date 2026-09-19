import { stat } from "node:fs/promises";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { DiscoveredAssets } from "@mdcz/shared/types";
import type { PublicationOutputPort } from "../publication/types";

type ResolveRoot = (rootId: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>;

export interface RegisteredMediaLocation {
  groupId?: string;
  nfoPath?: string;
  strmPath?: string;
  generatedStrmPaths?: string[];
  assets: DiscoveredAssets;
}

export const registeredMediaLocations = async (
  outputs: PublicationOutputPort,
  resolveRoot: ResolveRoot,
  mediaPaths: readonly string[],
): Promise<Map<string, RegisteredMediaLocation>> => {
  const snapshot = outputs.publicationSnapshot({ paths: mediaPaths, includeOwners: true });
  const roots = new Map(
    await Promise.all(
      [...new Set([...snapshot.files, ...snapshot.assets].map((ref) => ref.rootId))].map(
        async (id) => [id, await resolveRoot(id)] as const,
      ),
    ),
  );
  const absolute = (ref: RootFileRef) => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Resource root not found: ${ref.rootId}`);
    return resolveRootRelativePath(root, ref.relativePath);
  };
  const byItem = new Map<string, RegisteredMediaLocation>();
  for (const asset of snapshot.assets) {
    if (asset.fileId !== null) continue;
    const location = byItem.get(asset.itemId) ?? { assets: { sceneImages: [], actorPhotos: [] } };
    const path = absolute(asset);
    if (asset.published && asset.kind === "strm") {
      location.generatedStrmPaths ??= [];
      location.generatedStrmPaths.push(path);
    }
    byItem.set(asset.itemId, location);
    if (asset.kind === "nfo") location.nfoPath ??= path;
    else if (asset.kind === "strm") location.strmPath ??= path;
    else if (asset.kind === "scene") location.assets.sceneImages.push(path);
    else if (asset.kind === "actor") location.assets.actorPhotos.push(path);
    else if (["thumb", "poster", "fanart", "trailer"].includes(asset.kind))
      location.assets[asset.kind as "thumb" | "poster" | "fanart" | "trailer"] = path;
  }
  return new Map(
    snapshot.files.map((file) => [
      absolute(file),
      {
        ...(byItem.get(file.itemId) ?? { assets: { sceneImages: [], actorPhotos: [] } }),
        groupId: file.itemId,
        strmPath: snapshot.assets
          .filter((asset) => asset.fileId === file.fileId && asset.kind === "strm")
          .map(absolute)[0],
        generatedStrmPaths: snapshot.assets
          .filter((asset) => asset.fileId === file.fileId && asset.kind === "strm" && asset.published)
          .map(absolute),
      },
    ]),
  );
};

export const registeredOutputPaths = async (
  outputs: PublicationOutputPort,
  resolveRoot: ResolveRoot,
  kind: string,
): Promise<Set<string>> => {
  const assets = outputs.publicationSnapshot({ kind }).assets;
  const roots = new Map(
    await Promise.all(
      [...new Set(assets.map((asset) => asset.rootId))].map(async (id) => [id, await resolveRoot(id)] as const),
    ),
  );
  return new Set(
    assets.map((asset) => {
      const root = roots.get(asset.rootId);
      if (!root) throw new Error(`Resource root not found: ${asset.rootId}`);
      return filesystemPathKey(resolveRootRelativePath(root, asset.relativePath));
    }),
  );
};

export const resolveRegisteredNfoPaths = async (
  nfoPath: string,
  outputs: PublicationOutputPort,
  resolveRoot: ResolveRoot,
): Promise<{ paths: string[]; mediaPaths: string[] } | undefined> => {
  const snapshot = outputs.publicationSnapshot({ paths: [nfoPath], includeOwners: true });
  const roots = new Map(
    await Promise.all(
      [...new Set([...snapshot.assets, ...snapshot.files].map((ref) => ref.rootId))].map(
        async (id) => [id, await resolveRoot(id)] as const,
      ),
    ),
  );
  const absolute = (ref: RootFileRef) => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Resource root not found: ${ref.rootId}`);
    return resolveRootRelativePath(root, ref.relativePath);
  };
  const target = filesystemPathKey(nfoPath);
  const activeNfos = snapshot.assets.filter((asset) => asset.kind === "nfo");
  const nfos = activeNfos.map((asset) => ({
    ...asset,
    path: absolute(asset),
    key: filesystemPathKey(absolute(asset)),
  }));
  const owners = new Set(nfos.filter((asset) => asset.key === target && asset.published).map((asset) => asset.itemId));
  if (!owners.size) return undefined;
  const paths = [
    ...new Set(nfos.filter((asset) => asset.published && owners.has(asset.itemId)).map((asset) => asset.path)),
  ];
  for (const path of paths) if (!(await stat(path)).isFile()) throw new Error(`已登记的 NFO 输出不存在：${path}`);
  const mediaPaths = snapshot.files.filter((file) => owners.has(file.itemId)).map(absolute);
  return {
    paths,
    mediaPaths,
  };
};
