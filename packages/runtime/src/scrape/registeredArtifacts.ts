import {
  type MediaRoot,
  readRootFile,
  resolveRootFile,
  resolveRootRelativePath,
  StorageError,
  storageErrorCodes,
} from "@mdcz/media-store";
import type { NfoNamingMode } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import { applyNfoEditorChanges } from "@mdcz/shared/nfoEditor";
import type { CrawlerData, NfoEditorField } from "@mdcz/shared/types";
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
  changedFields: readonly NfoEditorField[];
  configuration: Configuration;
  /** The names an unregistered movie is written under; a library movie keeps its registered NFOs. */
  nfoNaming: NfoNamingMode;
  nfoGenerator: Pick<NfoGenerator, "mergeEditableXml" | "buildXml">;
  publication: {
    roots: readonly MediaRoot[];
    outputs?: PublicationOutputPort;
    library?: MovieLibrary;
  };
}): Promise<string> {
  const { nfoPath, videoPath, data, changedFields, configuration, nfoNaming, nfoGenerator, publication } = input;
  const plannedPath = resolveFilenameNfoPath(nfoPath, videoPath);
  const paths = getNfoWritePaths(plannedPath, nfoNaming);
  const owned = publication.outputs
    ? await resolveRegisteredNfoPaths(nfoPath, publication.outputs, async (id) => {
        const root = publication.roots.find((root) => root.id === id);
        if (!root) throw new Error(`Publication root not found: ${id}`);
        return root;
      })
    : undefined;
  const library = publication.library;
  if (owned && !library) throw new Error("Registered NFO write requires library updates");
  const targets = owned?.paths ?? paths.requiredPaths;
  const candidates = owned?.paths ?? getNfoReadCandidates(nfoPath, nfoNaming, videoPath);
  const inventory = new DirectoryInventory();
  const release = await acquireOutputDirectories([...targets, ...candidates], (directory) =>
    inventory.canonicalDirectory(directory),
  );
  try {
    const existing = new Map<string, string>();
    for (const candidate of new Set([...targets, ...candidates])) {
      const { root, relativePath } = resolveRootFile(publication.roots, candidate);
      const content = await readRootFile(root, relativePath).catch((error: unknown) => {
        if (!owned && error instanceof StorageError && error.code === storageErrorCodes.MissingPath) return null;
        throw error;
      });
      if (content !== null) existing.set(candidate, content.toString("utf-8"));
    }
    const fallback = candidates.map((candidate) => existing.get(candidate)).find((xml) => xml !== undefined);
    const sourceData = fallback === undefined ? data : parseNfoSnapshot(fallback).crawlerData;
    const artifacts = targets.map((targetPath) => {
      const xml = existing.get(targetPath) ?? fallback;
      const snapshot = xml === undefined ? undefined : parseNfoSnapshot(xml);
      const options = {
        buildTags: buildMovieTags,
        localState: snapshot?.localState,
        enabledFields: nfoIgnoreFieldsToEnabledFields(configuration.download.nfoIgnoreFields),
        nfoNaming,
        titleNaming: configuration.naming,
      };
      return {
        targetPath,
        data:
          xml === undefined || !snapshot
            ? nfoGenerator.buildXml(data, options)
            : nfoGenerator.mergeEditableXml(
                xml,
                applyNfoEditorChanges(snapshot.crawlerData, data, changedFields),
                changedFields,
                options,
              ),
      };
    });
    await new WriteOutput().install(artifacts, {
      protectedMediaFiles: owned?.mediaPaths ?? (videoPath ? [videoPath] : []),
      commit: async () => {
        if (!owned || !library) return;
        const entry = await library.getEntryById(owned.movieId);
        const currentData: CrawlerData = entry.crawlerDataJson ? JSON.parse(entry.crawlerDataJson) : sourceData;
        await writePublishedMovie(
          library,
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
          applyNfoEditorChanges(currentData, data, changedFields),
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
  if (owners.length > 1)
    throw new Error("The same video file is referenced by multiple library movies; cannot determine cover");
  if (!owners.length) return null;
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
