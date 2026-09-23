import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { LibraryRepository, MediaRootRepository } from "@mdcz/persistence";
import { expect, it } from "vitest";
import { createTestPersistenceDatabase } from "../../../../packages/persistence/src/testDatabase";
import { createTempDirectory } from "../../../harness/tempDirectory";

it.each([false, true])("removes a file index and keeps disk files (last file: %s)", async (last) => {
  const directory = await createTempDirectory("library-file-remove");
  const database = createTestPersistenceDatabase();
  try {
    const library = new LibraryRepository(database);
    const root = createMediaRoot({ id: "media", displayName: "Media", hostPath: directory.path });
    await new MediaRootRepository(database).upsert(root);
    for (const name of ["CD1.mp4", "CD2.mp4", "CD2.srt", "movie.nfo", "poster.jpg"])
      await writeFile(join(directory.path, name), name);
    if (!last)
      await library.upsertEntry({
        movie: { id: "movie" },
        files: [{ fileId: "cd1", rootId: root.id, rootRelativePath: "CD1.mp4" }],
      });
    await library.upsertEntry({
      movie: {
        id: "movie",
        assets: [
          { kind: "nfo", uri: "movie.nfo", rootId: root.id, relativePath: "movie.nfo", published: true },
          { kind: "poster", uri: "poster.jpg", rootId: root.id, relativePath: "poster.jpg", published: true },
        ],
      },
      files: [
        {
          fileId: "cd2",
          rootId: root.id,
          rootRelativePath: "CD2.mp4",
          assets: [{ kind: "subtitle", uri: "CD2.srt", rootId: root.id, relativePath: "CD2.srt", published: true }],
        },
      ],
    });

    library.removeFile("cd2");
    if (last) await expect(library.getEntryById("movie")).rejects.toThrow("not found");
    else {
      const entry = await library.getEntryById("movie");
      expect(entry.files.map((file) => file.id)).toEqual(["cd1"]);
      expect(entry.assets.every((asset) => asset.fileId !== "cd2")).toBe(true);
    }
    for (const name of ["CD1.mp4", "CD2.mp4", "CD2.srt", "movie.nfo", "poster.jpg"])
      await expect(readFile(join(directory.path, name), "utf8")).resolves.toBe(name);
  } finally {
    database.close();
    await directory.cleanup();
  }
});
