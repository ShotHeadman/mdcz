import { dirname } from "node:path";
import {
  type MediaRoot,
  readRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
  toRootRelativePath,
} from "@mdcz/media-store";
import { registeredMediaLocations } from "@mdcz/runtime";
import { resolveFileNaming } from "@mdcz/runtime/library";
import { LocalScanService, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import {
  getNfoReadCandidates,
  type NfoGenerator,
  type PosterCropService,
  type PosterCropSession,
  registeredPosterCropContext,
  writeNfoPublication,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
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

const toCropSessionResponse = (root: Pick<MediaRoot, "id" | "hostPath">, session: PosterCropSession) => ({
  rootId: root.id,
  ...("url" in session.source
    ? { sourceUrl: session.source.url }
    : { sourceRelativePath: requireRootRelativeAssetPath(root, session.source.path) }),
  targetRelativePath: requireRootRelativeAssetPath(root, session.targetPath),
  width: session.width,
  height: session.height,
  initialCrop: session.initialCrop,
});

export class ServerPosterCropAdapter {
  private readonly localScanService = new LocalScanService(async (paths) => {
    const state = await this.persistence.getState();
    return registeredMediaLocations(state.repositories.library, (id) => state.repositories.mediaRoots.get(id), paths);
  });

  constructor(
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly posterCropService: PosterCropService,
    private readonly persistence: ServerPersistenceService,
    private readonly nfoGenerator: NfoGenerator,
  ) {}

  /** Null when the video is not in the library. */
  private async context(video: RootFileRef) {
    const sourceRoot = await this.mediaRoots.get(video.rootId);
    const videoPath = resolveRootRelativePath(sourceRoot, video.relativePath);
    const state = await this.persistence.getState();
    const context = await registeredPosterCropContext(videoPath, state.repositories.library, (id) =>
      this.mediaRoots.get(id),
    );
    if (!context) return null;
    const configuration = await this.config.get();
    const entry = await this.localScanService.scanVideo(sourceRoot, videoPath, configuration.paths.sceneImagesFolder);
    const naming = await resolveFileNaming({
      libraries: state.repositories.mediaLibraries.list(),
      videoPath,
      metadataDir: dirname(entry.assets.poster ?? entry.assets.thumb ?? videoPath),
      configuration,
    });
    return {
      root: context.root ?? sourceRoot,
      movieId: context.movieId,
      entry,
      assetNaming: naming.assetNaming,
      configuration,
      library: state.repositories.library,
    };
  }

  /** Null when there is nothing to crop: the video is not in the library, or its movie has no image to cut. */
  async session(video: RootFileRef): Promise<PosterCropSessionResponse | null> {
    const context = await this.context(video);
    const session = context && (await this.posterCropService.prepare(context.entry, context.assetNaming));
    return context && session ? toCropSessionResponse(context.root, session) : null;
  }

  async save(input: PosterCropSaveInput): Promise<PosterCropSessionResponse> {
    const context = await this.context(input);
    if (!context) throw new Error("Current video is not in library; cannot retrieve saved cover");
    const session = await this.posterCropService.save(context.entry, context.assetNaming, input.crop, {
      config: context.configuration,
      dataDir: this.config.runtimePaths.dataDir,
      nfoGenerator: this.nfoGenerator,
      movie: { library: context.library, movieId: context.movieId, roots: await this.mediaRoots.listRoots() },
      logger: runtimeLoggerService.getLogger("PosterCrop"),
    });
    return { ...toCropSessionResponse(context.root, session), revision: String(Date.now()) };
  }
}
