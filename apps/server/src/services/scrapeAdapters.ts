import {
  type MediaRoot,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
  toRootRelativePath,
} from "@mdcz/media-store";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import {
  getNfoReadCandidates,
  type NfoGenerator,
  type PosterCropService,
  registeredPosterCropContext,
  writeNfoPublication,
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
import type { ServerPersistenceService } from "./persistenceService";

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

const requireRootRelativeAssetPath = (root: Pick<MediaRoot, "id" | "hostPath">, assetPath: string): string => {
  const relativePath = toRootRelativePath(root, assetPath);
  if (!relativePath) throw new Error(`Poster asset is outside the active media root: ${assetPath}`);
  return relativePath;
};

export class ServerNfoAdapter {
  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly nfoGenerator: NfoGenerator,
    private readonly persistence: ServerPersistenceService,
  ) {}

  async read(input: NfoReadInput): Promise<NfoReadResponse> {
    const [root, configuration] = await Promise.all([this.mediaRoots.get(input.rootId), this.config.get()]);
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
    const [root, configuration] = await Promise.all([this.mediaRoots.get(input.rootId), this.config.get()]);
    const state = await this.persistence.getState();
    const canonicalPath = await writeNfoPublication({
      nfoPath: resolveRootRelativePath(root, input.relativePath),
      videoPath: input.videoRelativePath ? resolveRootRelativePath(root, input.videoRelativePath) : undefined,
      data: input.data,
      configuration,
      nfoGenerator: this.nfoGenerator,
      publication: {
        roots: await this.mediaRoots.listRoots(),
        journal: state.repositories.publicationJournal,
        outputs: state.repositories.library,
        library: state.repositories.library,
        repairIssues: state.repositories.libraryRepairIssues,
      },
    });
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      effectiveRelativePath: toRootRelativePath(root, canonicalPath),
      data: input.data,
    };
  }
}

export class ServerPosterCropAdapter {
  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly posterCropService: PosterCropService,
    private readonly persistence: ServerPersistenceService,
  ) {}

  private async context(record: ServerScrapeArtifactRecord) {
    const sourceRoot = await this.mediaRoots.get(record.outputRootId ?? record.rootId);
    const videoPath = resolveRootRelativePath(sourceRoot, record.outputRelativePath ?? record.relativePath);
    const state = await this.persistence.getState();
    const context = await registeredPosterCropContext(videoPath, state.repositories.library, (id) =>
      this.mediaRoots.get(id),
    );
    return { ...context, root: context.root ?? sourceRoot };
  }

  async session(record: ServerScrapeArtifactRecord) {
    const [{ root, videoPath, assets }, configuration] = await Promise.all([this.context(record), this.config.get()]);
    const session = await this.posterCropService.prepare(videoPath, configuration.naming.assetNamingMode, assets);
    return {
      rootId: root.id,
      sourceRelativePath: requireRootRelativeAssetPath(root, session.sourcePath),
      targetRelativePath: requireRootRelativeAssetPath(root, session.targetPath),
      width: session.width,
      height: session.height,
      initialCrop: session.initialCrop,
    } satisfies PosterCropSessionResponse;
  }

  async save(record: ServerScrapeArtifactRecord, input: PosterCropSaveInput) {
    const [{ root, videoPath, assets }, configuration] = await Promise.all([this.context(record), this.config.get()]);
    const state = await this.persistence.getState();
    const result = await this.posterCropService.save(
      videoPath,
      configuration.naming.assetNamingMode,
      input.crop,
      {
        journal: state.repositories.publicationJournal,
        outputs: state.repositories.library,
        library: state.repositories.library,
        repairIssues: state.repositories.libraryRepairIssues,
        roots: await this.mediaRoots.listRoots(),
      },
      assets,
    );
    return {
      rootId: root.id,
      sourceRelativePath: requireRootRelativeAssetPath(root, result.sourcePath),
      targetRelativePath: requireRootRelativeAssetPath(root, result.targetPath),
      width: result.width,
      height: result.height,
      initialCrop: result.initialCrop,
      revision: result.revision,
    } satisfies PosterCropSessionResponse;
  }
}
