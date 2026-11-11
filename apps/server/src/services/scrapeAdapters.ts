import { dirname } from "node:path";
import {
  type MediaRoot,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
  toRootRelativePath,
} from "@mdcz/media-store";
import { resolveFileNaming } from "@mdcz/runtime/library";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import {
  getNfoReadCandidates,
  type NfoGenerator,
  type PosterCropService,
  registeredPosterCropContext,
  writeNfoPublication,
} from "@mdcz/runtime/scrape";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
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

  private async nfoNaming(root: MediaRoot, input: Pick<NfoReadInput, "relativePath" | "videoRelativePath">) {
    const nfoPath = resolveRootRelativePath(root, input.relativePath);
    const naming = await resolveFileNaming({
      libraries: (await this.persistence.getState()).repositories.mediaLibraries.list(),
      videoPath: input.videoRelativePath ? resolveRootRelativePath(root, input.videoRelativePath) : nfoPath,
      metadataDir: dirname(nfoPath),
      configuration: await this.config.get(),
    });
    return naming.nfoNaming;
  }

  async read(input: NfoReadInput): Promise<NfoReadResponse> {
    const root = await this.mediaRoots.get(input.rootId);
    const candidates = getNfoReadCandidates(
      input.relativePath,
      await this.nfoNaming(root, input),
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
    const publication = await writeNfoPublication({
      nfoPath: resolveRootRelativePath(root, input.relativePath),
      videoPath: input.videoRelativePath ? resolveRootRelativePath(root, input.videoRelativePath) : undefined,
      data: input.data,
      changedFields: input.changedFields,
      configuration,
      nfoNaming: await this.nfoNaming(root, input),
      nfoGenerator: this.nfoGenerator,
      publication: {
        roots: await this.mediaRoots.listRoots(),
        outputs: state.repositories.library,
        library: state.repositories.library,
      },
    });
    return {
      rootId: input.rootId,
      relativePath: input.relativePath,
      effectiveRelativePath: toRootRelativePath(root, publication.path),
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

  private async context(video: RootFileRef) {
    const sourceRoot = await this.mediaRoots.get(video.rootId);
    const videoPath = resolveRootRelativePath(sourceRoot, video.relativePath);
    const state = await this.persistence.getState();
    const context = await registeredPosterCropContext(videoPath, state.repositories.library, (id) =>
      this.mediaRoots.get(id),
    );
    return context && { ...context, root: context.root ?? sourceRoot };
  }

  private async assetNaming(videoPath: string, assets: { thumb?: string; poster?: string }) {
    const naming = await resolveFileNaming({
      libraries: (await this.persistence.getState()).repositories.mediaLibraries.list(),
      videoPath,
      metadataDir: dirname(assets.poster ?? assets.thumb ?? videoPath),
      configuration: await this.config.get(),
    });
    return naming.assetNaming;
  }

  /** Null when there is no saved cover to crop: the video is not in the library, or its movie has no local image. */
  async session(video: RootFileRef): Promise<PosterCropSessionResponse | null> {
    const context = await this.context(video);
    if (!context || (!context.assets.thumb && !context.assets.poster)) return null;
    const { root, videoPath, assets } = context;
    const session = await this.posterCropService.prepare(videoPath, await this.assetNaming(videoPath, assets), assets);
    return {
      rootId: root.id,
      sourceRelativePath: requireRootRelativeAssetPath(root, session.sourcePath),
      targetRelativePath: requireRootRelativeAssetPath(root, session.targetPath),
      width: session.width,
      height: session.height,
      initialCrop: session.initialCrop,
    } satisfies PosterCropSessionResponse;
  }

  async save(input: PosterCropSaveInput) {
    const context = await this.context(input);
    if (!context) throw new Error("Current video is not in library; cannot retrieve saved cover");
    const { root, videoPath, assets, movieId } = context;
    const state = await this.persistence.getState();
    const result = await this.posterCropService.save(
      videoPath,
      await this.assetNaming(videoPath, assets),
      input.crop,
      assets,
      {
        library: state.repositories.library,
        movieId,
        roots: await this.mediaRoots.listRoots(),
      },
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
