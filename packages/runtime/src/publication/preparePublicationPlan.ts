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
  sourceVideoPath: string;
  outputVideoPath: string;
  stagingDir?: string;
  existingAssetDir: string;
  metadataOutputDir: string;
  downloadedAssets: DownloadedAssets;
  actorPhotoPaths: string[];
  existingAssets?: DiscoveredAssets;
  existingNfoPath?: string;
  assetDecisions?: MaintenanceAssetDecisions;
  organizePlan?: OrganizePlan;
  organizeFiles?: boolean;
  renameSubtitles?: boolean;
  nfoNaming: "both" | "movie" | "filename";
  assetNamingMode?: AssetNamingMode;
  strmPathMappings?: Configuration["paths"]["strmPathMappings"];
  reuseNfo?: boolean;
  remoteData?: CrawlerData;
  writeNfo(
    assets: DownloadedAssets,
    writeFile: (path: string, content: string) => Promise<void>,
  ): Promise<string | undefined>;
}): Promise<{ plan: PreparedPublicationPlan; assets: DiscoveredAssets; nfoPath?: string }> => {
  const artifacts: PreparedPublicationPlan["artifacts"] = [];
  const sidecars: NonNullable<PreparedPublicationPlan["sidecars"]> = [];
  const mapped = new Map<string, string>();
  const existing = input.existingAssets;
  const downloaded = input.downloadedAssets;
  const organizeFiles = input.organizeFiles !== false;
  const independentOutput = Boolean(input.organizePlan?.strmPath);
  const preserveSourceMedia = independentOutput && resolve(input.sourceVideoPath) === resolve(input.outputVideoPath);
  const assetFileNames = input.assetNamingMode
    ? buildMovieAssetFileNames(
        basename(
          input.organizePlan?.nfoPath ?? input.outputVideoPath,
          input.organizePlan ? ".nfo" : parse(input.outputVideoPath).ext,
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
    input.reuseNfo && input.organizePlan
      ? getNfoWritePaths(input.organizePlan.nfoPath, input.nfoNaming).canonicalPath
      : await input.writeNfo(
          { ...assets, downloaded: [...new Set(artifacts.map(({ targetPath }) => targetPath))] },
          async (targetPath, data) => {
            artifacts.push({ targetPath, content: { kind: "text", data } });
          },
        );
  if (!nfoPath && input.existingNfoPath) {
    const paths = getNfoWritePaths(input.organizePlan?.nfoPath ?? input.existingNfoPath, input.nfoNaming);
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
  if (input.organizePlan?.strmPath) {
    artifacts.push({
      targetPath: input.organizePlan.strmPath,
      content: {
        kind: "text",
        data: await prepareStrmMirrorContent(input.sourceVideoPath, input.outputVideoPath, input.strmPathMappings),
      },
    });
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
  if (input.organizePlan?.strmPath) assetRefs.push({ kind: "strm", targetPath: input.organizePlan.strmPath });
  if (input.organizePlan) {
    const { strmPath } = input.organizePlan;
    for (const sidecar of input.organizePlan.subtitleSidecars ?? []) {
      const targetPath = !organizeFiles
        ? sidecar.path
        : input.renameSubtitles
          ? buildSubtitleSidecarTargetPath(sidecar, input.outputVideoPath)
          : join(dirname(input.outputVideoPath), basename(sidecar.path));
      const movingSubtitle = resolve(targetPath) !== resolve(sidecar.path);
      if (!strmPath || movingSubtitle) assetRefs.push({ kind: "subtitle", targetPath });
      if (!movingSubtitle && !strmPath) continue;
      const { size } = await stat(sidecar.path);
      if (movingSubtitle) sidecars.push({ sourcePath: sidecar.path, targetPath, size });
      if (strmPath) {
        const copyPath = buildSubtitleSidecarTargetPath(sidecar, strmPath);
        artifacts.push({ targetPath: copyPath, content: { kind: "file", path: sidecar.path, size } });
        assetRefs.push({ kind: "subtitle", targetPath: copyPath });
      }
    }
    for (const sidecar of !organizeFiles || preserveSourceMedia
      ? []
      : await findGeneratedVideoSidecars(input.sourceVideoPath)) {
      sidecars.push({
        sourcePath: sidecar.path,
        targetPath: buildGeneratedVideoSidecarTargetPath(
          sidecar,
          dirname(input.outputVideoPath),
          parse(input.organizePlan.nfoPath).name,
        ),
        size: (await stat(sidecar.path)).size,
        shared: true,
      });
    }
  }
  assetRefs.push(
    ...sidecars.filter((move) => move.shared).map((move) => ({ kind: "feature", targetPath: move.targetPath })),
  );
  const size = (await stat(input.sourceVideoPath)).size;
  const plan: PreparedPublicationPlan = {
    media: [{ sourcePath: input.sourceVideoPath, targetPath: input.outputVideoPath, size, assets: assetRefs }],
    videos:
      input.organizePlan && organizeFiles && resolve(input.sourceVideoPath) !== resolve(input.outputVideoPath)
        ? [
            {
              sourcePath: input.sourceVideoPath,
              targetPath: input.outputVideoPath,
              size,
              content: await prepareMovedStrmContent(input.sourceVideoPath, input.outputVideoPath),
            },
          ]
        : [],
    sidecars,
    artifacts,
    assets: assetRefs,
    obsoletePaths: [],
    replaceExistingTargetPaths: [
      ...new Set([...artifacts.map(({ targetPath }) => targetPath), ...sidecars.map(({ targetPath }) => targetPath)]),
    ],
  };
  if (input.organizePlan?.strmPath) {
    const moves = [...(plan.videos ?? []), ...sidecars];
    const changingSubtitlePaths = new Set(
      (input.organizePlan.subtitleSidecars ?? [])
        .filter((subtitle) => moves.some((move) => !move.preserveSource && move.sourcePath === subtitle.path))
        .map((subtitle) => subtitle.path),
    );
    plan.boundary = await capturePublicationBoundary({
      writeRoots: [
        input.organizePlan.metadataRoot ?? input.metadataOutputDir,
        ...(!preserveSourceMedia || changingSubtitlePaths.size
          ? [dirname(input.sourceVideoPath), dirname(input.outputVideoPath)]
          : []),
      ],
      writablePaths: [
        ...plan.artifacts.map((artifact) => artifact.targetPath),
        ...moves.flatMap((move) => (move.preserveSource ? [move.targetPath] : [move.sourcePath, move.targetPath])),
        ...plan.obsoletePaths,
      ],
      readOnlyPaths: [
        ...(preserveSourceMedia
          ? [
              input.sourceVideoPath,
              ...(input.organizePlan.subtitleSidecars ?? [])
                .filter((sidecar) => !changingSubtitlePaths.has(sidecar.path))
                .map((sidecar) => sidecar.path),
            ]
          : []),
        ...sidecars.filter((move) => move.preserveSource).map((move) => move.sourcePath),
      ],
      readOnlyDirectories: preserveSourceMedia && !changingSubtitlePaths.size ? [dirname(input.sourceVideoPath)] : [],
    });
  }
  return { assets, nfoPath, plan };
};
