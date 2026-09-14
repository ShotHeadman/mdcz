import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { type AssetNamingMode, buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { OrganizePlan } from "../scrape/FileOrganizer";
import {
  buildGeneratedVideoSidecarTargetPath,
  buildSubtitleSidecarTargetPath,
  findGeneratedVideoSidecars,
} from "../scrape/media";
import { getNfoWritePaths } from "../scrape/nfo";
import { prepareMovedStrmContent, prepareStrmMirrorContent } from "../scrape/utils/strm";
import { capturePublicationBoundary } from "./boundary";
import type { PreparedPublicationPlan } from "./types";

export const preparePublicationPlan = async (input: {
  files: readonly { sourceVideoPath: string; outputVideoPath: string; organizePlan?: OrganizePlan }[];
  stagingDir?: string;
  existingAssetDir: string;
  metadataOutputDir: string;
  downloadedAssets: DownloadedAssets;
  actorPhotoPaths: string[];
  existingAssets?: DiscoveredAssets;
  existingNfoPath?: string;
  assetDecisions?: MaintenanceAssetDecisions;
  organizeFiles?: boolean;
  renameSubtitles?: boolean;
  nfoNaming: "both" | "movie" | "filename";
  assetNamingMode?: AssetNamingMode;
  strmPathMappings?: Configuration["paths"]["strmPathMappings"];
  reuseNfo?: boolean;
  remoteData?: CrawlerData;
  onFileError?(sourcePath: string, error: unknown): void;
  writeNfo(
    assets: DownloadedAssets,
    writeFile: (path: string, content: string) => Promise<void>,
  ): Promise<string | undefined>;
}): Promise<{ plan: PreparedPublicationPlan; assets: DiscoveredAssets; nfoPath?: string }> => {
  const first = input.files[0];
  if (!first) throw new Error("Publication requires at least one media file");
  const artifacts: PreparedPublicationPlan["artifacts"] = [];
  const sidecars: NonNullable<PreparedPublicationPlan["sidecars"]> = [];
  const videos: NonNullable<PreparedPublicationPlan["videos"]> = [];
  const media: NonNullable<PreparedPublicationPlan["media"]> = [];
  const writeRoots = new Set<string>();
  const readOnlyPaths = new Set<string>();
  const readOnlyDirectories = new Set<string>();
  const sharedSidecars = new Set<string>();
  const mapped = new Map<string, string>();
  const existing = input.existingAssets;
  const downloaded = input.downloadedAssets;
  const organizeFiles = input.organizeFiles !== false;
  for (const file of input.files) {
    try {
      const { sourceVideoPath, outputVideoPath, organizePlan } = file;
      const size = (await stat(sourceVideoPath)).size;
      const fileArtifacts: PreparedPublicationPlan["artifacts"] = [];
      const fileSidecars: typeof sidecars = [];
      const fileAssets: PreparedPublicationPlan["assets"] = [];
      const video =
        organizePlan && organizeFiles && resolve(sourceVideoPath) !== resolve(outputVideoPath)
          ? {
              sourcePath: sourceVideoPath,
              targetPath: outputVideoPath,
              size,
              content: await prepareMovedStrmContent(sourceVideoPath, outputVideoPath),
            }
          : undefined;
      const isMetadataOnly = Boolean(organizePlan?.metadataOnly);
      const hasSeparateMetadata = Boolean(
        organizePlan?.metadataRoot && organizePlan?.metadataDir && organizePlan.metadataDir !== organizePlan.outputDir,
      );
      const preserveSourceMedia =
        isMetadataOnly ||
        ((Boolean(organizePlan?.strmPath) || hasSeparateMetadata) &&
          resolve(sourceVideoPath) === resolve(outputVideoPath));
      if (organizePlan?.strmPath) {
        fileArtifacts.push({
          targetPath: organizePlan.strmPath,
          content: {
            kind: "text",
            data: await prepareStrmMirrorContent(sourceVideoPath, outputVideoPath, input.strmPathMappings),
          },
        });
        fileAssets.push({ kind: "strm", targetPath: organizePlan.strmPath });
      }
      for (const subtitle of organizePlan?.subtitleSidecars ?? []) {
        const targetPath =
          !organizeFiles || isMetadataOnly || preserveSourceMedia
            ? subtitle.path
            : input.renameSubtitles
              ? buildSubtitleSidecarTargetPath(subtitle, outputVideoPath)
              : join(dirname(outputVideoPath), basename(subtitle.path));
        const moving = resolve(targetPath) !== resolve(subtitle.path);
        if (!organizePlan?.strmPath || moving) fileAssets.push({ kind: "subtitle", targetPath });
        if (!moving && !organizePlan?.strmPath) continue;
        const { size } = await stat(subtitle.path);
        if (moving) fileSidecars.push({ sourcePath: subtitle.path, targetPath, size });
        if (organizePlan?.strmPath) {
          const copyPath = buildSubtitleSidecarTargetPath(subtitle, organizePlan.strmPath);
          fileArtifacts.push({ targetPath: copyPath, content: { kind: "file", path: subtitle.path, size } });
          fileAssets.push({ kind: "subtitle", targetPath: copyPath });
        }
      }
      for (const sidecar of !organizePlan || !organizeFiles || preserveSourceMedia
        ? []
        : await findGeneratedVideoSidecars(sourceVideoPath)) {
        const targetPath = buildGeneratedVideoSidecarTargetPath(
          sidecar,
          dirname(outputVideoPath),
          parse(organizePlan?.nfoPath ?? outputVideoPath).name,
        );
        fileAssets.push({ kind: "feature", targetPath });
        if (!sharedSidecars.has(`${sidecar.path}\0${targetPath}`))
          fileSidecars.push({
            sourcePath: sidecar.path,
            targetPath,
            size: (await stat(sidecar.path)).size,
            shared: true,
          });
      }
      if (organizePlan?.strmPath || hasSeparateMetadata) {
        const changing = new Set(fileSidecars.filter((move) => !move.preserveSource).map((move) => move.sourcePath));
        writeRoots.add(organizePlan?.metadataRoot ?? input.metadataOutputDir);
        if (!preserveSourceMedia || changing.size) {
          writeRoots.add(dirname(sourceVideoPath));
          writeRoots.add(dirname(outputVideoPath));
        }
        if (preserveSourceMedia) {
          readOnlyPaths.add(sourceVideoPath);
          for (const subtitle of organizePlan?.subtitleSidecars ?? [])
            if (!changing.has(subtitle.path)) readOnlyPaths.add(subtitle.path);
          if (!changing.size) readOnlyDirectories.add(dirname(sourceVideoPath));
        }
      }
      for (const move of fileSidecars) if (move.shared) sharedSidecars.add(`${move.sourcePath}\0${move.targetPath}`);
      if (video) videos.push(video);
      artifacts.push(...fileArtifacts);
      sidecars.push(...fileSidecars);
      media.push({ sourcePath: sourceVideoPath, targetPath: outputVideoPath, size, assets: fileAssets });
    } catch (error) {
      if (!input.onFileError) throw error;
      input.onFileError(file.sourceVideoPath, error);
    }
  }
  if (!media.length) throw new Error("No media files could be prepared for publication");
  const assetFileNames = input.assetNamingMode
    ? buildMovieAssetFileNames(
        basename(
          first.organizePlan?.nfoPath ?? first.outputVideoPath,
          first.organizePlan ? ".nfo" : parse(first.outputVideoPath).ext,
        ),
        input.assetNamingMode,
      )
    : undefined;
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
      let targetPath = mapped.get(sourcePath);
      if (!targetPath) {
        const stagedName = input.stagingDir ? within(input.stagingDir, sourcePath) : undefined;
        const existingName = within(input.existingAssetDir, sourcePath);
        const collection = group.key === "sceneImages" || group.key === "actorPhotos";
        const targetName =
          !collection && assetFileNames
            ? `${parse(assetFileNames[sourcePath === (downloaded.poster ?? existing?.poster) ? "poster" : group.key]).name}${parse(sourcePath).ext}`
            : undefined;
        targetPath =
          !organizeFiles && !stagedName
            ? sourcePath
            : join(
                input.metadataOutputDir,
                targetName ??
                  stagedName ??
                  existingName ??
                  (collection ? join(basename(dirname(sourcePath)), basename(sourcePath)) : basename(sourcePath)),
              );
        if (stagedName) {
          artifacts.push({
            targetPath,
            content: { kind: "file", path: sourcePath, size: (await stat(sourcePath)).size },
          });
        } else if (sourcePath !== targetPath) {
          sidecars.push({
            sourcePath,
            targetPath,
            size: (await stat(sourcePath)).size,
            preserveSource: true,
          });
        }
        mapped.set(sourcePath, targetPath);
      }
      targets.push(targetPath);
    }
    if (group.key === "sceneImages" || group.key === "actorPhotos") assets[group.key] = [...new Set(targets)];
    else assets[group.key] = targets[0];
  }
  let nfoPath =
    input.reuseNfo && first.organizePlan
      ? getNfoWritePaths(first.organizePlan.nfoPath, input.nfoNaming).canonicalPath
      : await input.writeNfo(
          { ...assets, downloaded: [...new Set(artifacts.map(({ targetPath }) => targetPath))] },
          async (targetPath, data) => {
            artifacts.push({ targetPath, content: { kind: "text", data } });
          },
        );
  if (!nfoPath && input.existingNfoPath) {
    const paths = getNfoWritePaths(first.organizePlan?.nfoPath ?? input.existingNfoPath, input.nfoNaming);
    nfoPath = paths.canonicalPath;
    let content = await readFile(input.existingNfoPath, "utf-8");
    if (organizeFiles && [...mapped].some(([source, target]) => source !== target)) {
      const xmlOptions = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false };
      const document = new XMLParser(xmlOptions).parse(content);
      let referencesChanged = false;
      const rewriteReferences = (nodes: Record<string, unknown>[], asset = false): void => {
        for (const node of nodes) {
          for (const [key, value] of Object.entries(node)) {
            if (key === "#text" && asset && typeof value === "string") {
              const target = mapped.get(resolve(input.existingAssetDir, value));
              if (target) {
                const reference = relative(input.metadataOutputDir, target).replaceAll("\\", "/");
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
      artifacts.push({ targetPath, content: { kind: "text", data: content } });
    }
  }
  const assetRefs: PreparedPublicationPlan["assets"] = [];
  for (const kind of ["thumb", "poster", "fanart", "trailer"] as const) {
    const targetPath = assets[kind];
    const url = input.remoteData?.[`${kind}_source_url`] ?? input.remoteData?.[`${kind}_url`];
    if (targetPath) assetRefs.push({ kind, targetPath });
    else if (url?.trim()) assetRefs.push({ kind, url });
  }
  assetRefs.push(...assets.sceneImages.map((targetPath) => ({ kind: "scene", targetPath })));
  assetRefs.push(...assets.actorPhotos.map((targetPath) => ({ kind: "actor", targetPath })));
  if (!assets.sceneImages.length)
    assetRefs.push(...(input.remoteData?.scene_images ?? []).map((url) => ({ kind: "scene", url })));
  if (nfoPath) {
    const nfoPaths = artifacts
      .filter((artifact) => artifact.targetPath.toLowerCase().endsWith(".nfo"))
      .map((artifact) => artifact.targetPath);
    assetRefs.push(...[...new Set([nfoPath, ...nfoPaths])].map((targetPath) => ({ kind: "nfo", targetPath })));
  }
  const allAssets = new Map<string, PreparedPublicationPlan["assets"][number]>();
  for (const file of media) {
    file.assets = [...assetRefs, ...(file.assets ?? [])];
    for (const asset of file.assets) allAssets.set(`${asset.kind}\0${asset.targetPath ?? asset.url}`, asset);
  }
  const plan: PreparedPublicationPlan = {
    media,
    videos,
    sidecars,
    artifacts,
    assets: [...allAssets.values()],
    obsoletePaths: [],
    replaceExistingTargetPaths: [
      ...new Set([...artifacts.map(({ targetPath }) => targetPath), ...sidecars.map(({ targetPath }) => targetPath)]),
    ],
  };
  if (writeRoots.size) {
    const moves = [...(plan.videos ?? []), ...sidecars];
    plan.boundary = await capturePublicationBoundary({
      writeRoots: [...writeRoots],
      writablePaths: [
        ...plan.artifacts.map((artifact) => artifact.targetPath),
        ...moves.flatMap((move) => (move.preserveSource ? [move.targetPath] : [move.sourcePath, move.targetPath])),
        ...plan.obsoletePaths,
      ],
      readOnlyPaths: [
        ...readOnlyPaths,
        ...sidecars.filter((move) => move.preserveSource).map((move) => move.sourcePath),
      ],
      readOnlyDirectories: [...readOnlyDirectories],
    });
  }
  return { assets, nfoPath, plan };
};
