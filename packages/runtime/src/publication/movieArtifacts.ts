import { basename, isAbsolute, relative, resolve } from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { DirectoryInventory } from "../scrape/DirectoryInventory";
import type { ResolvedPublicationLayout } from "../scrape/FileOrganizer";
import { getNfoWritePaths } from "../scrape/nfo";
import type { PublicationAssetLayout } from "./assetLayout";
import type { SourceMove } from "./MoveOutput";
import { toRootFileRef } from "./outputRefs";
import type { WriteArtifact } from "./WriteOutput";

export interface PreparedMovieFile {
  fileId: string;
  source: RootFileRef;
  target: RootFileRef;
  size: number;
  sourceSize: number;
  modifiedAt: Date;
  assets: AssetRef[];
  fileInfo?: Pick<import("@mdcz/shared/types").FileInfo, "part" | "resolution">;
  scrape?: {
    itemId: string;
    identity: Pick<import("@mdcz/shared/types").ScrapeResult, "rootId" | "relativePath" | "fileName" | "part">;
    fileInfo: import("@mdcz/shared/types").FileInfo;
    videoMeta?: import("@mdcz/shared/types").VideoMeta;
    error?: string;
    uncensoredAmbiguous: boolean;
  };
}

export interface MovieArtifacts {
  files: PreparedMovieFile[];
  movieAssets: AssetRef[];
  artifacts: WriteArtifact[];
  moves: SourceMove[];
  publishedTargets: RootFileRef[];
  protectedSourceRoots: string[];
  protectedMediaFiles: string[];
}

export interface PreparedMovieOutput extends MovieArtifacts {
  operationId: string;
  operationType: "scrape" | "maintenance";
  movieId: string;
  scrape?: {
    crawlerData: CrawlerData;
    sources: import("@mdcz/shared/types").ScrapeResult["sources"];
    nfo?: RootFileRef;
  };
}

interface MovieOutputMember {
  source: RootFileRef;
  fileId?: string;
  fileInfo?: PreparedMovieFile["fileInfo"];
  layout: Omit<ResolvedPublicationLayout, "sourceVideoPath">;
  assetLayout: PublicationAssetLayout;
  existingAssets?: DiscoveredAssets;
  existingNfoPath?: string;
  scrape?: PreparedMovieFile["scrape"];
}

const MANAGED_MOVIE_ASSET_KINDS = new Set(["nfo", "poster", "fanart", "thumb", "trailer", "scene", "actor"]);

export const retainedRegisteredFeatures = (
  members: readonly { layout: { sidecars: readonly { kind: string }[] } }[],
  registered: readonly (RootFileRef & { fileId: string | null; kind: string })[],
): AssetRef[] => {
  const hasFeatureSidecar = members.some((member) =>
    member.layout.sidecars.some((sidecar) => sidecar.kind === "feature"),
  );
  return registered.flatMap((asset) => {
    if (asset.fileId !== null) return [];
    if (asset.kind === "feature") {
      return hasFeatureSidecar
        ? []
        : [
            {
              type: "local" as const,
              kind: asset.kind,
              file: { rootId: asset.rootId, relativePath: asset.relativePath },
            },
          ];
    }
    if (!MANAGED_MOVIE_ASSET_KINDS.has(asset.kind)) {
      return [
        {
          type: "local" as const,
          kind: asset.kind,
          file: { rootId: asset.rootId, relativePath: asset.relativePath },
        },
      ];
    }
    return [];
  });
};

export const prepareMovieArtifacts = async (input: {
  inventory: DirectoryInventory;
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  members: Array<MovieOutputMember & { fileId: string }>;
  retainedMovieAssets?: AssetRef[];
  stagingDir?: string;
  downloadedAssets: DownloadedAssets;
  actorPhotoPaths: string[];
  assetDecisions?: MaintenanceAssetDecisions;
  nfoNaming: "both" | "movie" | "filename";
  reuseNfo?: boolean;
  remoteData?: CrawlerData;
  writeNfo(
    assets: DownloadedAssets,
    writeFile: (path: string, content: string) => Promise<void>,
  ): Promise<string | undefined>;
}): Promise<
  MovieArtifacts & {
    assets: DiscoveredAssets;
    nfoPath?: string;
  }
> => {
  if (!input.members.length) throw new Error("Publication requires at least one media file");
  const toRef = (absolutePath: string) => toRootFileRef(absolutePath, input.roots);
  const artifacts: WriteArtifact[] = [];
  const moves: SourceMove[] = [];
  const publishedTargets: RootFileRef[] = [];
  const successful: Array<{ member: (typeof input.members)[number]; file: PreparedMovieFile }> = [];
  const featureAssets = new Map<string, AssetRef>();
  const downloadedTargets = new Set<string>();
  const mapped = new Map<string, string>();
  const assetTargets = new Map<string, string>();
  const downloaded = input.downloadedAssets;
  const sourcePathOf = (file: MovieOutputMember) => {
    const root = input.roots.find((root) => root.id === file.source.rootId);
    if (!root) throw new Error(`Publication root not found: ${file.source.rootId}`);
    return resolveRootRelativePath(root, file.source.relativePath);
  };
  const mediaSources = new Set(input.members.map((file) => resolve(sourcePathOf(file))));

  for (const file of input.members) {
    const { layout } = file;
    const sourcePath = sourcePathOf(file);
    const source = await input.inventory.stats(sourcePath);
    if (!source.isFile()) throw new Error("Publication source is not a file");
    const fileAssets: AssetRef[] = [];
    const memberMoves: SourceMove[] = [];
    const memberFeatures = new Map<string, AssetRef>();
    let size = source.size;
    let modifiedAt = source.mtime;
    if (layout.mode === "move" && resolve(sourcePath) !== resolve(layout.targetVideoPath)) {
      if (layout.mediaContent === undefined) {
        const target = toRef(layout.targetVideoPath);
        moves.push({
          source: file.source,
          target,
          sourcePath,
          targetPath: layout.targetVideoPath,
          size: source.size,
          mtimeMs: source.mtimeMs,
        });
        publishedTargets.push(target);
      } else {
        const target = toRef(layout.targetVideoPath);
        moves.push({
          source: file.source,
          target,
          sourcePath,
          targetPath: layout.targetVideoPath,
          size: source.size,
          mtimeMs: source.mtimeMs,
          rewrittenContent: layout.mediaContent,
        });
        publishedTargets.push(target);
        size = Buffer.byteLength(layout.mediaContent);
        modifiedAt = new Date();
      }
    }
    if (layout.mirror) {
      const target = toRef(layout.mirror.targetPath);
      artifacts.push({ targetPath: layout.mirror.targetPath, data: layout.mirror.content });
      publishedTargets.push(target);
      fileAssets.push({ type: "local", kind: "strm", file: toRef(layout.mirror.targetPath) });
    }
    for (const sidecar of layout.sidecars) {
      const sidecarSource = await input.inventory.stats(sidecar.sourcePath);
      if (!sidecarSource.isFile()) throw new Error("Publication sidecar source is not a file");
      const moving = resolve(sidecar.targetPath) !== resolve(sidecar.sourcePath);
      if (sidecar.kind === "subtitle") {
        if (!layout.mirror || moving)
          fileAssets.push({ type: "local", kind: "subtitle", file: toRef(sidecar.targetPath) });
        if (moving) {
          const target = toRef(sidecar.targetPath);
          moves.push({
            source: toRef(sidecar.sourcePath),
            target,
            sourcePath: sidecar.sourcePath,
            targetPath: sidecar.targetPath,
            size: sidecarSource.size,
            mtimeMs: sidecarSource.mtimeMs,
          });
          publishedTargets.push(target);
        }
        if (sidecar.mirrorPath) {
          const target = toRef(sidecar.mirrorPath);
          artifacts.push({
            sourcePath: sidecar.sourcePath,
            targetPath: sidecar.mirrorPath,
            size: sidecarSource.size,
          });
          publishedTargets.push(target);
          fileAssets.push({ type: "local", kind: "subtitle", file: toRef(sidecar.mirrorPath) });
        }
      } else {
        if (
          mediaSources.has(resolve(sidecar.sourcePath)) ||
          featureAssets.has(sidecar.targetPath) ||
          memberFeatures.has(sidecar.targetPath)
        )
          continue;
        memberFeatures.set(sidecar.targetPath, {
          type: "local",
          kind: "feature",
          file: toRef(sidecar.targetPath),
        });
        if (moving) {
          const target = toRef(sidecar.targetPath);
          memberMoves.push({
            source: toRef(sidecar.sourcePath),
            target,
            sourcePath: sidecar.sourcePath,
            targetPath: sidecar.targetPath,
            size: sidecarSource.size,
            mtimeMs: sidecarSource.mtimeMs,
          });
          publishedTargets.push(target);
        }
      }
    }
    for (const [targetPath, asset] of memberFeatures) featureAssets.set(targetPath, asset);
    moves.push(...memberMoves);
    successful.push({
      member: file,
      file: {
        fileId: file.fileId,
        source: file.source,
        target: toRef(layout.targetVideoPath),
        size,
        sourceSize: source.size,
        modifiedAt,
        assets: fileAssets,
        fileInfo: file.fileInfo ?? file.scrape?.fileInfo,
        scrape: file.scrape,
      },
    });
  }

  const first = successful[0].member;
  const assets: DiscoveredAssets = { sceneImages: [], actorPhotos: [] };
  const within = (directory: string, filePath: string): string | undefined => {
    const name = relative(directory, filePath);
    return name &&
      name !== ".." &&
      !name.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(name)
      ? name
      : undefined;
  };
  const locationAssets = new Map<string, AssetRef>();
  const locations = new Map<string, (typeof input.members)[number]>();
  for (const { member: file } of successful) {
    if (!locations.has(file.layout.metadataDir)) locations.set(file.layout.metadataDir, file);
  }
  for (const [metadataOutputDir, file] of locations) {
    const existing = file.existingAssets;
    const groups = [
      { key: "thumb" as const, paths: [downloaded.thumb ?? existing?.thumb] },
      { key: "poster" as const, paths: [downloaded.poster ?? existing?.poster] },
      { key: "fanart" as const, paths: [downloaded.fanart ?? existing?.fanart] },
      {
        key: "trailer" as const,
        paths: [
          input.assetDecisions?.trailer === "replace" ? downloaded.trailer : (downloaded.trailer ?? existing?.trailer),
        ],
      },
      {
        key: "sceneImages" as const,
        paths: downloaded.sceneImages.length ? downloaded.sceneImages : (existing?.sceneImages ?? []),
      },
      {
        key: "actorPhotos" as const,
        paths: input.actorPhotoPaths.length ? input.actorPhotoPaths : (existing?.actorPhotos ?? []),
      },
    ];
    for (const group of groups) {
      const targets: string[] = [];
      for (const sourcePath of group.paths) {
        if (!sourcePath) continue;
        const mappingKey = `${sourcePath}\0${metadataOutputDir}`;
        let targetPath = assetTargets.get(mappingKey);
        if (!targetPath) {
          const stagedName = input.stagingDir ? within(input.stagingDir, sourcePath) : undefined;
          targetPath = stagedName ? file.assetLayout.staged.get(stagedName) : file.assetLayout.retained.get(sourcePath);
          if (!targetPath) throw new Error(`Publication asset has no declared destination: ${sourcePath}`);
          if (stagedName || sourcePath !== targetPath) {
            const target = toRef(targetPath);
            artifacts.push({
              sourcePath,
              targetPath,
              size: (await input.inventory.stats(sourcePath)).size,
              consume: Boolean(stagedName),
            });
            publishedTargets.push(target);
            if (stagedName) downloadedTargets.add(targetPath);
          }
          assetTargets.set(mappingKey, targetPath);
          if (metadataOutputDir === first.layout.metadataDir) mapped.set(sourcePath, targetPath);
        }
        targets.push(targetPath);
      }
      const kind = group.key === "sceneImages" ? "scene" : group.key === "actorPhotos" ? "actor" : group.key;
      for (const targetPath of targets)
        locationAssets.set(`${kind}\0${targetPath}`, { type: "local", kind, file: toRef(targetPath) });
      if (metadataOutputDir !== first.layout.metadataDir) continue;
      if (group.key === "sceneImages" || group.key === "actorPhotos") assets[group.key] = [...new Set(targets)];
      else assets[group.key] = targets[0];
    }
  }

  const allowedNfoPaths = new Set(
    successful.flatMap(({ member: file }) =>
      getNfoWritePaths(file.layout.nfoPath, input.nfoNaming).requiredPaths.map((path) => resolve(path)),
    ),
  );
  let nfoPath = input.reuseNfo
    ? getNfoWritePaths(first.layout.nfoPath, input.nfoNaming).canonicalPath
    : await input.writeNfo({ ...assets, downloaded: [...downloadedTargets] }, async (targetPath, data) => {
        if (!allowedNfoPaths.has(resolve(targetPath)))
          throw new Error(`NFO writer selected an undeclared layout destination: ${targetPath}`);
        const target = toRef(targetPath);
        artifacts.push({ targetPath, data });
        publishedTargets.push(target);
      });
  const writtenNfos = artifacts.filter(
    (a): a is Extract<WriteArtifact, { data: unknown }> =>
      a.targetPath.toLowerCase().endsWith(".nfo") && "data" in a && a.data !== undefined,
  );
  if (writtenNfos.length > 0) {
    for (const { member: file } of successful) {
      const required = getNfoWritePaths(file.layout.nfoPath, input.nfoNaming).requiredPaths;
      for (const reqPath of required) {
        if (!artifacts.some((a) => resolve(a.targetPath) === resolve(reqPath))) {
          const baseName = basename(reqPath);
          const match = writtenNfos.find((n) => basename(n.targetPath) === baseName) ?? writtenNfos[0];
          const target = toRef(reqPath);
          artifacts.push({ targetPath: reqPath, data: match.data });
          publishedTargets.push(target);
        }
      }
    }
  }
  const existingNfoPath = first.existingNfoPath;
  if (!nfoPath && existingNfoPath) {
    const paths = getNfoWritePaths(first.layout.nfoPath, input.nfoNaming);
    nfoPath = paths.canonicalPath;
    let content = await input.inventory.readNfo(existingNfoPath);
    if (content === undefined) throw new Error(`NFO source is missing: ${existingNfoPath}`);
    const relativeLayoutChanged =
      resolve(first.layout.existingMetadataDir) !== resolve(first.layout.metadataDir) ||
      [...mapped].some(([source, target]) => source !== target);
    if (relativeLayoutChanged) {
      const xmlOptions = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false };
      const document = new XMLParser(xmlOptions).parse(content);
      let referencesChanged = false;
      const rewriteReferences = (nodes: Record<string, unknown>[], asset = false): void => {
        for (const node of nodes) {
          for (const [key, value] of Object.entries(node)) {
            if (key === "#text" && asset && typeof value === "string") {
              const target = mapped.get(resolve(first.layout.existingMetadataDir, value));
              if (target) {
                const reference = relative(first.layout.metadataDir, target).replaceAll("\\", "/");
                if (reference !== value) {
                  node[key] = reference;
                  referencesChanged = true;
                }
              }
            } else if (Array.isArray(value)) {
              rewriteReferences(value, asset || ["thumb", "poster", "fanart", "trailer"].includes(key));
            }
          }
        }
      };
      rewriteReferences(document);
      if (referencesChanged) content = new XMLBuilder(xmlOptions).build(document);
    }
    for (const targetPath of paths.requiredPaths) {
      const target = toRef(targetPath);
      artifacts.push({ targetPath, data: content });
      publishedTargets.push(target);
    }
  }

  const movieAssets: AssetRef[] = [...locationAssets.values(), ...featureAssets.values()];
  for (const kind of ["thumb", "poster", "fanart", "trailer"] as const) {
    const targetPath = assets[kind];
    const url = input.remoteData?.[`${kind}_source_url`] ?? input.remoteData?.[`${kind}_url`];
    if (!targetPath && url?.trim()) movieAssets.push({ type: "remote", kind, url });
  }
  if (!assets.sceneImages.length)
    movieAssets.push(
      ...(input.remoteData?.scene_images ?? []).map((url) => ({ type: "remote" as const, kind: "scene", url })),
    );
  if (nfoPath) {
    const nfoFiles = new Map<string, RootFileRef>();
    const canonical = toRef(nfoPath);
    nfoFiles.set(`${canonical.rootId}\0${canonical.relativePath}`, canonical);
    for (const target of publishedTargets)
      if (target.relativePath.toLowerCase().endsWith(".nfo"))
        nfoFiles.set(`${target.rootId}\0${target.relativePath}`, target);
    movieAssets.push(...[...nfoFiles.values()].map((file) => ({ type: "local" as const, kind: "nfo", file })));
  }
  for (const asset of input.retainedMovieAssets ?? []) {
    const key =
      asset.type === "local"
        ? `${asset.kind}\0${asset.file.rootId}\0${asset.file.relativePath}`
        : `${asset.kind}\0${asset.url}`;
    if (
      !movieAssets.some((candidate) =>
        candidate.type === "local"
          ? `${candidate.kind}\0${candidate.file.rootId}\0${candidate.file.relativePath}` === key
          : `${candidate.kind}\0${candidate.url}` === key,
      )
    )
      movieAssets.push(asset);
  }
  for (const artifact of artifacts) {
    if (mediaSources.has(resolve(artifact.targetPath)))
      throw new Error(`Artifact target cannot overwrite a source media file: ${artifact.targetPath}`);
  }
  const targetRootIds = new Set(successful.map(({ file }) => file.target.rootId));
  const protectedSourceRoots = [
    ...new Set(
      input.members
        .filter((member) => !targetRootIds.has(member.source.rootId))
        .map((member) => input.roots.find((root) => root.id === member.source.rootId)?.hostPath)
        .filter((root): root is string => Boolean(root)),
    ),
  ];
  return {
    assets,
    nfoPath,
    files: successful.map((entry) => entry.file),
    movieAssets,
    artifacts,
    moves,
    publishedTargets,
    protectedSourceRoots,
    protectedMediaFiles: [...mediaSources],
  };
};
