import {
  type MediaRoot,
  readRootFile,
  resolveRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
} from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData } from "@mdcz/shared/types";
import { type MovieLibrary, resolveRegisteredNfoPaths, writePublishedMovie } from "../library/registeredMedia";
import { buildMovieTags } from "../maintenance/movieTags";
import { parseNfoSnapshot } from "../maintenance/nfoSnapshot";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import type { PublicationOutputPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
import { DirectoryInventory } from "./DirectoryInventory";
import {
  getNfoReadCandidates,
  getNfoWritePaths,
  type NfoGenerator,
  nfoIgnoreFieldsToEnabledFields,
  resolveFilenameNfoPath,
} from "./nfo";

export async function writeNfoPublication(input: {
  nfoPath: string;
  videoPath?: string;
  data: CrawlerData;
  configuration: Configuration;
  nfoGenerator: Pick<NfoGenerator, "mergeEditableXml" | "buildXml">;
  publication: {
    roots: readonly MediaRoot[];
    outputs?: PublicationOutputPort;
    library?: MovieLibrary;
  };
}): Promise<string> {
  const { nfoPath, videoPath, data, configuration, nfoGenerator, publication } = input;
  let existingXml: string | undefined;
  for (const candidate of getNfoReadCandidates(nfoPath, configuration.download.nfoNaming, videoPath)) {
    const { root, relativePath } = resolveRootFile(publication.roots, candidate);
    const content = await readRootFile(root, relativePath).catch((error: unknown) => {
      if (error instanceof StorageError && error.code === storageErrorCodes.MissingPath) return null;
      throw error;
    });
    if (content) {
      existingXml = content.toString("utf-8");
      break;
    }
  }
  const options = {
    buildTags: buildMovieTags,
    localState: existingXml ? parseNfoSnapshot(existingXml).localState : undefined,
    enabledFields: nfoIgnoreFieldsToEnabledFields(configuration.download.nfoIgnoreFields),
    nfoNaming: configuration.download.nfoNaming,
    nfoTitleTemplate: configuration.naming.nfoTitleTemplate,
  };
  const xml = existingXml
    ? nfoGenerator.mergeEditableXml(existingXml, data, options)
    : nfoGenerator.buildXml(data, options);
  const plannedPath = resolveFilenameNfoPath(nfoPath, videoPath);
  const paths = getNfoWritePaths(plannedPath, configuration.download.nfoNaming);
  const owned = publication.outputs
    ? await resolveRegisteredNfoPaths(nfoPath, publication.outputs, async (id) => {
        const root = publication.roots.find((root) => root.id === id);
        if (!root) throw new Error(`Publication root not found: ${id}`);
        return root;
      })
    : undefined;
  const artifacts = (owned?.paths ?? paths.requiredPaths).map((targetPath) => ({ targetPath, data: xml }));
  const inventory = new DirectoryInventory();
  const release = await acquireOutputDirectories(
    artifacts.map((artifact) => artifact.targetPath),
    (directory) => inventory.canonicalDirectory(directory),
  );
  try {
    await new WriteOutput().install(artifacts, {
      protectedMediaFiles: owned?.mediaPaths ?? (videoPath ? [videoPath] : []),
      commit: async () => {
        if (!owned) return;
        if (!publication.library) throw new Error("Registered NFO write requires library updates");
        await writePublishedMovie(
          publication.library,
          owned.movieId,
          artifacts.map((artifact) => {
            const ref = toRootFileRef(artifact.targetPath, publication.roots);
            return {
              kind: "nfo",
              uri: ref.relativePath,
              rootId: ref.rootId,
              relativePath: ref.relativePath,
              published: true,
            };
          }),
          data,
        );
      },
    });
  } finally {
    release();
  }
  return owned ? nfoPath : paths.canonicalPath;
}

export async function registeredPosterCropContext(
  videoPath: string,
  library: MovieLibrary & Pick<PublicationOutputPort, "publicationSnapshot">,
  resolveRoot: (id: string) => Promise<Pick<MediaRoot, "id" | "hostPath">>,
) {
  const snapshot = library.publicationSnapshot({ paths: [videoPath] });
  const owners = [...new Set(snapshot.files.map((file) => file.itemId))];
  if (owners.length > 1) throw new Error("同一视频文件已被媒体库中的多个影片重复引用，无法确定封面");
  if (!owners.length) throw new Error("当前视频尚未入库，无法获取已保存的封面");
  const movieId = owners[0];
  const entry = await library.getEntryById(movieId);
  const assets: { thumb?: string; poster?: string } = {};
  let root: Pick<MediaRoot, "id" | "hostPath"> | undefined;
  for (const kind of ["thumb", "poster"] as const) {
    const asset = entry.assets.find((asset) => asset.kind === kind && asset.rootId && asset.relativePath);
    if (!asset?.rootId || !asset.relativePath) continue;
    root = await resolveRoot(asset.rootId);
    assets[kind] = resolveRootRelativePath(root, asset.relativePath);
  }
  return { videoPath, assets, root, movieId };
}
