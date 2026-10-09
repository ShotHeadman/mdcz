import type { LibraryEntryFilter } from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import type { LibraryListInput } from "@mdcz/shared/serverDtos";
import type { MediaLibraryService } from "./mediaLibraryService";

/** A library owns the movies that live under its source or output directory. */
export const toLibraryEntryFilter = async (
  input: NonNullable<LibraryListInput> | undefined,
  libraries: Pick<MediaLibraryService, "get">,
  configuration: Pick<Configuration, "download">,
): Promise<LibraryEntryFilter> => {
  const { query, rootId, libraryId, health, actor, studio, tag } = input ?? {};
  const library = libraryId ? await libraries.get(libraryId) : undefined;
  return {
    query,
    rootId,
    health,
    includeBackdrop: configuration.download.downloadFanart,
    actor,
    studio,
    tag,
    pathPrefixes: library ? [library.sourcePath, library.outputPath].filter(Boolean) : undefined,
  };
};
