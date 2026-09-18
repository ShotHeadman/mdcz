import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { ResolvedPublicationLayout } from "../scrape/FileOrganizer";
import { getNfoWritePaths } from "../scrape/nfo";
import type { PublicationAssetLayout } from "./assetLayout";
import { toRootFileRef } from "./publicationPlan";
import type { MoviePublicationPlan, PublicationFile, PublicationOperation, PublicationParticipants } from "./types";

interface PublicationPlanningMember {
  source: RootFileRef;
  fileId?: string;
  layout: Omit<ResolvedPublicationLayout, "sourceVideoPath">;
  assetLayout: PublicationAssetLayout;
  existingAssets?: DiscoveredAssets;
  existingNfoPath?: string;
  scrape?: PublicationFile["scrape"];
}

export const retainedRegisteredFeatures = (
  members: readonly { layout: { sidecars: readonly { kind: string }[] } }[],
  registered: PublicationParticipants["expected"]["assets"],
): AssetRef[] =>
  members.some((member) => member.layout.sidecars.some((sidecar) => sidecar.kind === "feature"))
    ? []
    : registered.flatMap((asset) =>
        asset.fileId === null && asset.kind === "feature" && !asset.historical
          ? [
              {
                type: "local" as const,
                kind: asset.kind,
                file: { rootId: asset.rootId, relativePath: asset.relativePath },
              },
            ]
          : [],
      );

export const preparePublicationPlan = async (input: {
  operationId: string;
  operationType: MoviePublicationPlan["operationType"];
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
  identity: PublicationParticipants<PublicationPlanningMember>;
  retainedMovieAssets?: AssetRef[];
  stagingDir?: string;
  downloadedAssets: DownloadedAssets;
  actorPhotoPaths: string[];
  assetDecisions?: MaintenanceAssetDecisions;
  nfoNaming: "both" | "movie" | "filename";
  reuseNfo?: boolean;
  remoteData?: CrawlerData;
  scrape?: Omit<NonNullable<MoviePublicationPlan["scrape"]>, "nfo">;
  writeNfo(
    assets: DownloadedAssets,
    writeFile: (path: string, content: string) => Promise<void>,
  ): Promise<string | undefined>;
}): Promise<{
  plan: MoviePublicationPlan;
  assets: DiscoveredAssets;
  nfoPath?: string;
}> => {
  if (!input.identity.members.length) throw new Error("Publication requires at least one media file");
  const toRef = (absolutePath: string) => toRootFileRef(absolutePath, input.roots);
  const operations: PublicationOperation[] = [];
  const successful: Array<{ member: (typeof input.identity.members)[number]; file: PublicationFile }> = [];
  const featureAssets = new Map<string, AssetRef>();
  const downloadedTargets = new Set<string>();
  const obsolete: RootFileRef[] = [];
  const mapped = new Map<string, string>();
  const assetTargets = new Map<string, string>();
  const downloaded = input.downloadedAssets;
  const sourcePathOf = (file: PublicationPlanningMember) => {
    const root = input.roots.find((root) => root.id === file.source.rootId);
    if (!root) throw new Error(`Publication root not found: ${file.source.rootId}`);
    return resolveRootRelativePath(root, file.source.relativePath);
  };
  const mediaSources = new Set(input.identity.members.map((file) => resolve(sourcePathOf(file))));

  for (const file of input.identity.members) {
    const { layout } = file;
    const sourcePath = sourcePathOf(file);
    const source = await stat(sourcePath);
    if (!source.isFile()) throw new Error("Publication source is not a file");
    const fileOperations: PublicationOperation[] = [];
    const fileObsolete: RootFileRef[] = [];
    const fileAssets: AssetRef[] = [];
    const memberOperations: PublicationOperation[] = [];
    const memberFeatures = new Map<string, AssetRef>();
    let size = source.size;
    let modifiedAt = source.mtime;
    if (layout.mode === "move" && resolve(sourcePath) !== resolve(layout.targetVideoPath)) {
      if (layout.mediaContent === undefined) {
        fileOperations.push({
          kind: "move",
          source: file.source,
          target: toRef(layout.targetVideoPath),
          size: source.size,
          replaceExisting: false,
        });
      } else {
        fileOperations.push({
          kind: "write",
          target: toRef(layout.targetVideoPath),
          content: { kind: "text", data: layout.mediaContent },
          replaceExisting: false,
        });
        fileObsolete.push(file.source);
        size = Buffer.byteLength(layout.mediaContent);
        modifiedAt = new Date();
      }
    }
    if (layout.mirror) {
      fileOperations.push({
        kind: "write",
        target: toRef(layout.mirror.targetPath),
        content: { kind: "text", data: layout.mirror.content },
        replaceExisting: true,
      });
      fileAssets.push({ type: "local", kind: "strm", file: toRef(layout.mirror.targetPath) });
    }
    for (const sidecar of layout.sidecars) {
      const sidecarSource = await stat(sidecar.sourcePath);
      if (!sidecarSource.isFile()) throw new Error("Publication sidecar source is not a file");
      const moving = resolve(sidecar.targetPath) !== resolve(sidecar.sourcePath);
      if (sidecar.kind === "subtitle") {
        if (!layout.mirror || moving)
          fileAssets.push({ type: "local", kind: "subtitle", file: toRef(sidecar.targetPath) });
        if (moving) {
          fileOperations.push({
            kind: "move",
            source: toRef(sidecar.sourcePath),
            target: toRef(sidecar.targetPath),
            size: sidecarSource.size,
            replaceExisting: true,
          });
        }
        if (sidecar.mirrorPath) {
          fileOperations.push({
            kind: "copy",
            sourcePath: sidecar.sourcePath,
            target: toRef(sidecar.mirrorPath),
            size: sidecarSource.size,
            replaceExisting: true,
          });
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
          memberOperations.push({
            kind: "move",
            source: toRef(sidecar.sourcePath),
            target: toRef(sidecar.targetPath),
            size: sidecarSource.size,
            replaceExisting: true,
          });
        }
      }
    }
    obsolete.push(...fileObsolete);
    for (const [targetPath, asset] of memberFeatures) featureAssets.set(targetPath, asset);
    operations.push(...memberOperations);
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
        operations: fileOperations,
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
  const locations = new Map<string, (typeof input.identity.members)[number]>();
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
            operations.push({
              kind: "copy",
              sourcePath,
              target: toRef(targetPath),
              size: (await stat(sourcePath)).size,
              replaceExisting: true,
              consume: Boolean(stagedName),
            });
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
        operations.push({
          kind: "write",
          target: toRef(targetPath),
          content: { kind: "text", data },
          replaceExisting: true,
        });
      });
  const existingNfoPath = first.existingNfoPath;
  if (!nfoPath && existingNfoPath) {
    const paths = getNfoWritePaths(first.layout.nfoPath, input.nfoNaming);
    nfoPath = paths.canonicalPath;
    let content = await readFile(existingNfoPath, "utf-8");
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
      operations.push({
        kind: "write",
        target: toRef(targetPath),
        content: { kind: "text", data: content },
        replaceExisting: true,
      });
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
    for (const operation of operations) {
      if (operation.kind === "write" && operation.target.relativePath.toLowerCase().endsWith(".nfo")) {
        nfoFiles.set(`${operation.target.rootId}\0${operation.target.relativePath}`, operation.target);
      }
    }
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
  const plan: MoviePublicationPlan = {
    kind: "movie",
    operationId: input.operationId,
    operationType: input.operationType,
    movieId: input.identity.movieId,
    expected: input.identity.expected,
    files: successful.map((entry) => entry.file),
    operations,
    movieAssets,
    obsolete,
    ...(input.scrape ? { scrape: { ...input.scrape, ...(nfoPath ? { nfo: toRef(nfoPath) } : {}) } } : {}),
  };
  return { assets, nfoPath, plan };
};
