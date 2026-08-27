import {
  type MediaRoot,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
  toRootRelativePath,
} from "@mdcz/media-store";
import { buildMovieTags, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { commitPublishedMedia } from "@mdcz/runtime/publication";
import {
  getNfoReadCandidates,
  getNfoWritePaths,
  type NfoGenerator,
  nfoIgnoreFieldsToEnabledFields,
  type PosterCropService,
  resolveFilenameNfoPath,
} from "@mdcz/runtime/scrape";
import type {
  NfoReadInput,
  NfoReadResponse,
  NfoWriteInput,
  NfoWriteResponse,
  PosterCropSaveInput,
  PosterCropSessionResponse,
} from "@mdcz/shared/serverDtos";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";

export interface ServerScrapeArtifactRecord {
  rootId: string;
  relativePath: string;
  nfoRootId: string | null;
  outputRootId: string | null;
  outputRelativePath: string | null;
}

const readExistingNfo = async (
  root: MediaRoot,
  candidates: readonly string[],
): Promise<{ content: Buffer; relativePath: string } | null> => {
  for (const relativePath of candidates) {
    const content = await readRootFile(root, relativePath).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === storageErrorCodes.MissingPath) return null;
      throw error;
    });
    if (content) return { content, relativePath };
  }
  return null;
};

const requireRootRelativeAssetPath = (root: MediaRoot, assetPath: string): string => {
  const relativePath = toRootRelativePath(root, assetPath);
  if (!relativePath) throw new Error(`Poster asset is outside the active media root: ${assetPath}`);
  return relativePath;
};

export class ServerNfoAdapter {
  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly nfoGenerator: NfoGenerator,
  ) {}

  async read(input: NfoReadInput): Promise<NfoReadResponse> {
    const [root, configuration] = await Promise.all([this.mediaRoots.getActiveRoot(input.rootId), this.config.get()]);
    const candidates = getNfoReadCandidates(
      input.relativePath,
      configuration.download.nfoNaming,
      input.videoRelativePath,
    );
    const existing = await readExistingNfo(root, candidates);
    const effectiveRelativePath = existing?.relativePath ?? candidates[0] ?? input.relativePath;
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      effectiveRelativePath,
      exists: existing !== null,
      data: existing === null ? null : parseNfoSnapshot(existing.content.toString("utf-8")).crawlerData,
    };
  }

  async write(input: NfoWriteInput): Promise<NfoWriteResponse> {
    const [root, configuration] = await Promise.all([this.mediaRoots.getActiveRoot(input.rootId), this.config.get()]);
    const plannedRelativePath = resolveFilenameNfoPath(input.relativePath, input.videoRelativePath);
    const candidates = getNfoReadCandidates(
      input.relativePath,
      configuration.download.nfoNaming,
      input.videoRelativePath,
    );
    const existing = await readExistingNfo(root, candidates);
    const existingXml = existing?.content.toString("utf-8");
    const existingLocalState = existingXml ? parseNfoSnapshot(existingXml).localState : undefined;
    const options = {
      buildTags: buildMovieTags,
      enabledFields: nfoIgnoreFieldsToEnabledFields(configuration.download.nfoIgnoreFields),
      localState: existingLocalState,
      nfoNaming: configuration.download.nfoNaming,
      nfoTitleTemplate: configuration.naming.nfoTitleTemplate,
    };
    const xml = existingXml
      ? this.nfoGenerator.mergeEditableXml(existingXml, input.data, options)
      : this.nfoGenerator.buildXml(input.data, options);
    const paths = getNfoWritePaths(plannedRelativePath, configuration.download.nfoNaming);
    await commitPublishedMedia(
      {
        operationId: `nfo-write:${input.rootId}:${plannedRelativePath}`,
        operationType: "maintenance",
        artifacts: paths.requiredPaths.map((relativePath) => ({
          target: { rootId: root.id, relativePath },
          content: { kind: "text" as const, data: xml },
        })),
        assets: [],
        obsolete: paths.stalePaths.map((relativePath) => ({ rootId: root.id, relativePath })),
        replaceExistingTargets: paths.requiredPaths.map((relativePath) => ({ rootId: root.id, relativePath })),
      },
      { resolveRoot: async () => root, commit: async () => undefined },
    );
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      effectiveRelativePath: paths.canonicalPath,
      data: input.data,
    };
  }
}

export class ServerPosterCropAdapter {
  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly posterCropService: PosterCropService,
    private readonly resolveMetadataVideoPath: (result: ServerScrapeArtifactRecord) => string,
  ) {}

  async session(record: ServerScrapeArtifactRecord) {
    const [root, configuration] = await Promise.all([
      this.mediaRoots.getActiveRoot(record.nfoRootId ?? record.outputRootId ?? record.rootId),
      this.config.get(),
    ]);
    const session = await this.posterCropService.prepare(
      resolveRootRelativePath(root, this.resolveMetadataVideoPath(record)),
      configuration.naming.assetNamingMode,
    );
    return {
      sourceRelativePath: requireRootRelativeAssetPath(root, session.sourcePath),
      targetRelativePath: requireRootRelativeAssetPath(root, session.targetPath),
      width: session.width,
      height: session.height,
      initialCrop: session.initialCrop,
    } satisfies PosterCropSessionResponse;
  }

  async save(record: ServerScrapeArtifactRecord, input: PosterCropSaveInput) {
    const [root, configuration] = await Promise.all([
      this.mediaRoots.getActiveRoot(record.nfoRootId ?? record.outputRootId ?? record.rootId),
      this.config.get(),
    ]);
    const result = await this.posterCropService.save(
      resolveRootRelativePath(root, this.resolveMetadataVideoPath(record)),
      configuration.naming.assetNamingMode,
      input.crop,
    );
    return {
      sourceRelativePath: requireRootRelativeAssetPath(root, result.sourcePath),
      targetRelativePath: requireRootRelativeAssetPath(root, result.targetPath),
      width: result.width,
      height: result.height,
      initialCrop: result.initialCrop,
      revision: result.revision,
    } satisfies PosterCropSessionResponse;
  }
}
