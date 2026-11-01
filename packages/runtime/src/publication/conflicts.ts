import { join } from "node:path";
import { isSharedDirectoryTarget, type PublicationTarget } from "@mdcz/shared/mediaLibrary";
import { outputFileSystem } from "./outputFileSystem";
import type { PublicationOutputPort } from "./types";

export class PublicationConflictError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly targetPath: string,
    readonly reason = "Destination already contains a movie",
  ) {
    super(`${reason}.\nSource: ${sourcePath}\nDestination: ${targetPath}`);
    this.name = "PublicationConflictError";
  }
}

/**
 * A folder template with a per-movie field promises each movie a folder of its own, yet two titles can match, or match
 * once cut to the name length limit. The later movie fails instead of moving in beside the first one, whose fixed-name
 * files it would replace. Callers hold the folders' output lock, so the listing and the library are current.
 */
export const assertFoldersHoldNoOtherMovie = async (input: {
  target: Pick<PublicationTarget, "placement" | "folderTemplate">;
  movieId: string;
  sourcePaths: readonly string[];
  folders: readonly string[];
  library: Pick<PublicationOutputPort, "publicationSnapshot">;
}): Promise<void> => {
  if (input.target.placement === "inPlace" || isSharedDirectoryTarget(input.target)) return;
  // A rescrape starts as a new movie and joins the library movie its files belong to only when it commits.
  const movieIds = new Set([
    input.movieId,
    ...input.library.publicationSnapshot({ paths: input.sourcePaths }).files.map((file) => file.itemId),
  ]);
  for (const folder of new Set(input.folders)) {
    const paths = await outputFileSystem.readdir(folder, { withFileTypes: true }).then(
      (entries) => entries.map((entry) => join(folder, entry.name)),
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    if (!paths.length) continue;
    const { files, assets } = input.library.publicationSnapshot({ paths });
    if ([...files, ...assets].some((row) => !movieIds.has(row.itemId)))
      throw new PublicationConflictError(
        input.sourcePaths[0] ?? folder,
        folder,
        "Another movie already has this folder; add {number} to the library's folder template so each movie gets its own",
      );
  }
};
