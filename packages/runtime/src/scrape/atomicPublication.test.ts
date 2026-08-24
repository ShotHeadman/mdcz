import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../../tests/harness/tempDirectory";
import { ActorPhotoMaterializer } from "./actorImage/ActorPhotoMaterializer";
import { NfoGenerator } from "./nfo";
import { writeStrmTarget } from "./utils/strm";

const tempDirectories: TempDirectoryHarness[] = [];

const createRoot = async (): Promise<string> => {
  const directory = await createTempDirectory("runtime-publication");
  tempDirectories.push(directory);
  return directory.path;
};

const crawlerData: CrawlerData = {
  title: "Atomic publication",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => directory.cleanup()));
});

describe("runtime formal file publication", () => {
  it("publishes every required NFO alias without leaving temporary files", async () => {
    const root = await createRoot();
    const nfoPath = join(root, "movie", "ABC-123.nfo");
    const movieNfoPath = join(root, "movie", "movie.nfo");
    await mkdir(join(root, "movie"), { recursive: true });
    await writeFile(nfoPath, "old filename NFO");
    await writeFile(movieNfoPath, "old movie NFO");

    const savedPath = await new NfoGenerator().writeNfo(nfoPath, crawlerData, { nfoNaming: "both" });

    expect(savedPath).toBe(nfoPath);
    const [filenameXml, movieXml] = await Promise.all([readFile(nfoPath, "utf8"), readFile(movieNfoPath, "utf8")]);
    expect(filenameXml).toBe(movieXml);
    expect(filenameXml).toContain("<title>Atomic publication</title>");
    await expect(readdir(join(root, "movie"))).resolves.toEqual(["ABC-123.nfo", "movie.nfo"]);
  });

  it("replaces STRM content without leaving a publication temporary file", async () => {
    const root = await createRoot();
    const strmPath = join(root, "movie.strm");
    await writeFile(strmPath, "#KODIPROP:inputstream=inputstream.adaptive\nold-target\n");

    await writeStrmTarget(strmPath, "https://example.com/new.m3u8");

    await expect(readFile(strmPath, "utf8")).resolves.toBe(
      "#KODIPROP:inputstream=inputstream.adaptive\nhttps://example.com/new.m3u8\n",
    );
    await expect(readdir(root)).resolves.toEqual(["movie.strm"]);
  });

  it("publishes a replacement actor photo before replacing the old target", async () => {
    const root = await createRoot();
    const sourcePath = join(root, "cache", "actor.jpg");
    const movieDirectory = join(root, "movie");
    const targetPath = join(movieDirectory, ".actors", "Actor A.jpg");
    await mkdir(join(root, "cache"), { recursive: true });
    await mkdir(join(movieDirectory, ".actors"), { recursive: true });
    await writeFile(sourcePath, "new-photo");
    await writeFile(targetPath, "old-photo");

    const result = await new ActorPhotoMaterializer({ info: () => undefined }).materializeForMovie(
      movieDirectory,
      "Actor A",
      sourcePath,
    );

    expect(result).toBe(".actors/Actor A.jpg");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("new-photo");
    await expect(readdir(join(movieDirectory, ".actors"))).resolves.toEqual(["Actor A.jpg"]);
  });
});
