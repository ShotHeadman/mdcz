import { stat } from "node:fs/promises";
import { filesystemPathKey, type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, DiscoveredAssets } from "@mdcz/shared/types";
import type { PublicationLibraryAsset } from "../publication/outputLibrary";
import type { PublicationOutputPort } from "../publication/types";

type ResolveRoot = (rootId: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>;

export interface RegisteredMediaLocation {
  groupId?: string;
  nfoPath?: string;
  assets: DiscoveredAssets;
}

export const registeredMediaLocations = async (
  entry: LibraryEntryRecord | PublicationOutputPort,
  resolveRoot: ResolveRoot,
  mediaPaths: readonly string[] = [],
): Promise<Map<string, RegisteredMediaLocation>> => {
  const snapshot =
    "publicationSnapshot" in entry
      ? entry.publicationSnapshot({ paths: mediaPaths, includeOwners: true })
      : {
          files: entry.files.map((file) => ({
            itemId: entry.id,
            fileId: file.id,
            rootId: file.rootId,
            relativePath: file.rootRelativePath,
          })),
          assets: entry.assets.flatMap((asset) =>
            asset.rootId && asset.relativePath
              ? [{ ...asset, rootId: asset.rootId, relativePath: asset.relativePath }]
              : [],
          ),
        };
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
    byItem.set(asset.itemId, location);
    if (asset.kind === "nfo") location.nfoPath ??= path;
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

export type MovieLibrary = {
  getEntryById(id: string): Promise<{
    assets: Array<PublicationLibraryAsset & { fileId: string | null }>;
  }>;
  writeEntry(
    movie: {
      id: string;
      mediaIdentity?: string;
      title?: string;
      number?: string;
      actors?: string[];
      crawlerDataJson?: string;
      lastRefreshedAt?: Date;
      assets?: PublicationLibraryAsset[];
    },
    files: readonly {
      fileId: string;
      rootId: string;
      rootRelativePath: string;
      assets?: PublicationLibraryAsset[];
    }[],
  ): string;
};

export const writePublishedMovie = async (
  library: MovieLibrary,
  movieId: string,
  assets: PublicationLibraryAsset[],
  crawlerData?: CrawlerData,
): Promise<void> => {
  if (assets.some((asset) => asset.kind === "subtitle")) {
    throw new Error("Registered tools only write movie assets");
  }
  const entry = await library.getEntryById(movieId);
  library.writeEntry(
    {
      id: movieId,
      ...(crawlerData
        ? {
            mediaIdentity: crawlerData.number,
            title: crawlerData.title,
            number: crawlerData.number,
            actors: crawlerData.actors,
            crawlerDataJson: JSON.stringify(crawlerData),
            lastRefreshedAt: new Date(),
          }
        : {}),
      assets: [
        ...entry.assets.filter(
          (asset) =>
            asset.fileId === null &&
            !assets.some(
              (replacement) =>
                replacement.kind === asset.kind &&
                replacement.rootId === asset.rootId &&
                replacement.relativePath === asset.relativePath,
            ),
        ),
        ...assets,
      ],
    },
    [],
  );
};

export const resolveRegisteredNfoPaths = async (
  nfoPath: string,
  outputs: PublicationOutputPort,
  resolveRoot: ResolveRoot,
): Promise<{ movieId: string; paths: string[]; mediaPaths: string[] } | undefined> => {
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
  if (owners.size > 1) throw new Error("同一 NFO 已被媒体库中的多个影片重复引用");
  const movieId = [...owners][0];
  const paths = [
    ...new Set(nfos.filter((asset) => asset.published && asset.itemId === movieId).map((asset) => asset.path)),
  ];
  for (const path of paths) if (!(await stat(path)).isFile()) throw new Error(`已登记的 NFO 输出不存在：${path}`);
  const mediaPaths = snapshot.files.filter((file) => file.itemId === movieId).map(absolute);
  return {
    movieId,
    paths,
    mediaPaths,
  };
};
