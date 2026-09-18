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
import { resolveRegisteredNfoPaths } from "../library/registeredMedia";
import { buildMovieTags } from "../maintenance/movieTags";
import { parseNfoSnapshot } from "../maintenance/nfoSnapshot";
import { commitRegisteredPublication } from "../publication/registered";
import type { PublicationOutputPort, RegisteredPublicationContext } from "../publication/types";
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
  publication: RegisteredPublicationContext & { roots: readonly MediaRoot[]; outputs: PublicationOutputPort };
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
  const owned = await resolveRegisteredNfoPaths(nfoPath, publication.outputs, async (id) => {
    const root = publication.roots.find((root) => root.id === id);
    if (!root) throw new Error(`Publication root not found: ${id}`);
    return root;
  });
  await commitRegisteredPublication(
    {
      operationId: `nfo-write:${plannedPath}`,
      operationType: "maintenance",
      mediaPaths: owned?.mediaPaths,
      operations: (owned?.paths ?? paths.requiredPaths).map((targetPath) => ({
        kind: "write",
        owner: owned ? "movie" : "unmanaged",
        assetKind: "nfo",
        targetPath,
        content: { kind: "text", data: xml },
        replaceExisting: true,
      })),
    },
    publication,
  );
  return owned ? nfoPath : paths.canonicalPath;
}

export async function registeredPosterCropContext(
  videoPath: string,
  library: NonNullable<RegisteredPublicationContext["library"]> & Pick<PublicationOutputPort, "publicationSnapshot">,
  resolveRoot: (id: string) => Promise<RegisteredPublicationContext["roots"][number]>,
) {
  const snapshot = library.publicationSnapshot({ paths: [videoPath] });
  const owners = [...new Set(snapshot.files.map((file) => file.itemId))];
  if (owners.length > 1) throw new Error("同一视频文件已被媒体库中的多个影片重复引用，无法确定封面");
  if (!owners.length) throw new Error("当前视频尚未入库，无法获取已保存的封面");
  const entry = await library.getEntryById(owners[0]);
  const assets: { thumb?: string; poster?: string } = {};
  let root: RegisteredPublicationContext["roots"][number] | undefined;
  for (const kind of ["thumb", "poster"] as const) {
    const asset = entry.assets.find(
      (asset) => asset.kind === kind && !asset.historical && asset.rootId && asset.relativePath,
    );
    if (!asset?.rootId || !asset.relativePath) continue;
    root = await resolveRoot(asset.rootId);
    assets[kind] = resolveRootRelativePath(root, asset.relativePath);
  }
  return { videoPath, assets, root };
}
