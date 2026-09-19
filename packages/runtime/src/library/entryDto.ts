import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { libraryAvailability } from "@mdcz/shared/libraryAvailability";
import type { CrawlerDataDto, LibraryEntryDto } from "@mdcz/shared/serverDtos";

type LibraryEntryDtoSource = Pick<
  LibraryEntryDto,
  | "id"
  | "mediaIdentity"
  | "displayFileId"
  | "size"
  | "title"
  | "number"
  | "actors"
  | "thumbnailPath"
  | "thumbnailRootId"
  | "assets"
> & {
  crawlerDataJson: string | null;
  createdAt: Date;
  lastRefreshedAt: Date | null;
  hiddenFromRecentAt: Date | null;
  files: Array<
    Pick<
      LibraryEntryDto["fileRefs"][number],
      "id" | "rootId" | "fileName" | "directory" | "size" | "lastKnownPath" | "partNumber" | "partSuffix" | "resolution"
    > & {
      rootRelativePath: string;
      modifiedAt: Date | null;
      sourceRunId: string | null;
      sourceItemId: string | null;
    }
  >;
};

export const parseLibraryCrawlerData = (value: string | null): CrawlerDataDto | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as CrawlerDataDto;
  } catch {
    return null;
  }
};

export const toLibraryEntryDto = (
  entry: LibraryEntryDtoSource,
  roots: ReadonlyMap<string, Pick<MediaRoot, "id" | "hostPath" | "displayName">>,
): LibraryEntryDto => {
  const fileRefs: LibraryEntryDto["fileRefs"] = entry.files.map((file) => {
    const root = roots.get(file.rootId);
    return {
      id: file.id,
      rootId: file.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      relativePath: file.rootRelativePath,
      fileName: file.fileName,
      directory: file.directory,
      size: file.size,
      modifiedAt: file.modifiedAt?.toISOString() ?? null,
      lastKnownPath: root ? resolveRootRelativePath(root, file.rootRelativePath) : file.lastKnownPath,
      partNumber: file.partNumber,
      partSuffix: file.partSuffix,
      resolution: file.resolution,
      runId: file.sourceRunId,
      scrapeOutcomeId: file.sourceItemId,
      available: null,
      availabilityError: null,
    };
  });
  return {
    id: entry.id,
    mediaIdentity: entry.mediaIdentity,
    displayFileId: entry.displayFileId,
    size: entry.size,
    title: entry.title,
    number: entry.number,
    actors: entry.actors,
    crawlerData: parseLibraryCrawlerData(entry.crawlerDataJson),
    thumbnailPath: entry.thumbnailPath,
    thumbnailRootId: entry.thumbnailRootId,
    createdAt: entry.createdAt.toISOString(),
    lastRefreshedAt: entry.lastRefreshedAt?.toISOString() ?? null,
    hiddenFromRecentAt: entry.hiddenFromRecentAt?.toISOString() ?? null,
    available: libraryAvailability(fileRefs),
    fileRefs,
    assets: entry.assets.map(({ id, fileId, kind, uri, rootId, relativePath }) => ({
      id,
      fileId,
      kind,
      uri,
      rootId,
      relativePath,
    })),
  };
};
