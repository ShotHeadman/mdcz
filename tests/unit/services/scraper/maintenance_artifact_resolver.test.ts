import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaintenanceArtifactResolver } from "@main/services/scraper/maintenance/MaintenanceArtifactResolver";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-maintenance-artifacts-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createEntry = (root: string, nfoFileName = "ABC-123.nfo") => ({
  fileId: "entry-1",
  videoPath: join(root, "ABC-123.mp4"),
  fileInfo: {
    filePath: join(root, "ABC-123.mp4"),
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: join(root, nfoFileName),
  assets: {
    sceneImages: [],
    actorPhotos: [],
  },
  currentDir: root,
});

const createPlan = (root: string) => {
  const outputDir = join(root, "organized");
  return {
    outputDir,
    targetVideoPath: join(outputDir, "ABC-123.mp4"),
    nfoPath: join(outputDir, "ABC-123.nfo"),
  };
};

describe("MaintenanceArtifactResolver", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("reconciles kept NFO naming during maintenance reorganization", async () => {
    for (const scenario of [
      {
        nfoNaming: "filename" as const,
        expectedCanonicalName: "ABC-123.nfo",
        expectMovieAlias: false,
        title: "Kept Title",
      },
      {
        nfoNaming: "movie" as const,
        expectedCanonicalName: "movie.nfo",
        expectMovieAlias: true,
        title: "Movie Mode",
      },
    ]) {
      const root = await createTempDir();
      const entry = createEntry(root);
      const plan = createPlan(root);
      const resolver = new MaintenanceArtifactResolver();
      const canonicalPath = join(plan.outputDir, scenario.expectedCanonicalName);
      const filenamePath = plan.nfoPath;
      const moviePath = join(plan.outputDir, "movie.nfo");
      const sourceMoviePath = join(root, "movie.nfo");

      await writeFile(entry.nfoPath, `<movie><title>${scenario.title}</title></movie>`, "utf8");
      await writeFile(sourceMoviePath, "<movie><title>Stale Alias</title></movie>", "utf8");

      const result = await resolver.resolve({
        entry,
        plan,
        outputVideoPath: plan.targetVideoPath,
        nfoNaming: scenario.nfoNaming,
      });

      expect(result.nfoPath).toBe(canonicalPath);
      await expect(readFile(canonicalPath, "utf8")).resolves.toContain(scenario.title);
      await expect(readFile(sourceMoviePath, "utf8")).rejects.toThrow();
      if (scenario.expectMovieAlias) {
        await expect(readFile(filenamePath, "utf8")).rejects.toThrow();
        continue;
      }
      await expect(readFile(moviePath, "utf8")).rejects.toThrow();
    }
  });

  it("moves preserved local assets into the organized directory when no replacements were downloaded", async () => {
    const root = await createTempDir();
    const thumbPath = join(root, "thumb.jpg");
    const posterPath = join(root, "poster.jpg");
    const fanartPath = join(root, "fanart.jpg");
    const sceneImagePath = join(root, "extrafanart", "fanart1.jpg");
    const trailerPath = join(root, "trailer.mp4");
    const actorPhotoPath = join(root, ".actors", "Actor A.jpg");
    const entry = {
      ...createEntry(root),
      assets: {
        thumb: thumbPath,
        poster: posterPath,
        fanart: fanartPath,
        sceneImages: [sceneImagePath],
        trailer: trailerPath,
        actorPhotos: [actorPhotoPath],
      },
    };
    const plan = createPlan(root);
    const resolver = new MaintenanceArtifactResolver();

    await mkdir(join(root, "extrafanart"), { recursive: true });
    await mkdir(join(root, ".actors"), { recursive: true });
    await writeFile(thumbPath, "thumb", "utf8");
    await writeFile(posterPath, "poster", "utf8");
    await writeFile(fanartPath, "fanart", "utf8");
    await writeFile(trailerPath, "trailer", "utf8");
    await writeFile(sceneImagePath, "scene-1", "utf8");
    await writeFile(actorPhotoPath, "actor-a", "utf8");

    const result = await resolver.resolve({
      entry,
      plan,
      outputVideoPath: plan.targetVideoPath,
      preferredAssets: {
        thumb: entry.assets.thumb,
        poster: entry.assets.poster,
        fanart: entry.assets.fanart,
        sceneImages: entry.assets.sceneImages,
        trailer: entry.assets.trailer,
      },
    });

    expect(result.assets).toEqual({
      thumb: join(plan.outputDir, "thumb.jpg"),
      poster: join(plan.outputDir, "poster.jpg"),
      fanart: join(plan.outputDir, "fanart.jpg"),
      sceneImages: [join(plan.outputDir, "extrafanart", "fanart1.jpg")],
      trailer: join(plan.outputDir, "trailer.mp4"),
      actorPhotos: [join(plan.outputDir, ".actors", "Actor A.jpg")],
    });
    await expect(readFile(join(plan.outputDir, "thumb.jpg"), "utf8")).resolves.toBe("thumb");
    await expect(readFile(join(plan.outputDir, "poster.jpg"), "utf8")).resolves.toBe("poster");
    await expect(readFile(join(plan.outputDir, "fanart.jpg"), "utf8")).resolves.toBe("fanart");
    await expect(readFile(join(plan.outputDir, "trailer.mp4"), "utf8")).resolves.toBe("trailer");
    await expect(readFile(join(plan.outputDir, "extrafanart", "fanart1.jpg"), "utf8")).resolves.toBe("scene-1");
    await expect(readFile(join(plan.outputDir, ".actors", "Actor A.jpg"), "utf8")).resolves.toBe("actor-a");
    await expect(readFile(thumbPath, "utf8")).rejects.toThrow();
    await expect(readFile(sceneImagePath, "utf8")).rejects.toThrow();
    await expect(readFile(actorPhotoPath, "utf8")).rejects.toThrow();
  });

  it("removes stale source assets after replacements were already created in the output directory", async () => {
    const root = await createTempDir();
    const plan = createPlan(root);
    const outputScenePath = join(plan.outputDir, "extrafanart", "fanart1.jpg");
    const outputActorPath = join(plan.outputDir, ".actors", "Actor A.jpg");
    const thumbPath = join(root, "thumb.jpg");
    const sceneImagePath = join(root, "extrafanart", "fanart1.jpg");
    const trailerPath = join(root, "trailer.mp4");
    const actorPhotoPath = join(root, ".actors", "Actor A.jpg");
    const entry = {
      ...createEntry(root),
      assets: {
        thumb: thumbPath,
        poster: undefined,
        fanart: undefined,
        sceneImages: [sceneImagePath],
        trailer: trailerPath,
        actorPhotos: [actorPhotoPath],
      },
    };
    const resolver = new MaintenanceArtifactResolver();

    await mkdir(join(root, "extrafanart"), { recursive: true });
    await mkdir(join(root, ".actors"), { recursive: true });
    await mkdir(join(plan.outputDir, "extrafanart"), { recursive: true });
    await mkdir(join(plan.outputDir, ".actors"), { recursive: true });
    await writeFile(thumbPath, "old-thumb", "utf8");
    await writeFile(sceneImagePath, "old-scene", "utf8");
    await writeFile(trailerPath, "old-trailer", "utf8");
    await writeFile(actorPhotoPath, "old-actor", "utf8");
    await writeFile(join(plan.outputDir, "thumb.jpg"), "new-thumb", "utf8");
    await writeFile(outputScenePath, "new-scene", "utf8");
    await writeFile(join(plan.outputDir, "trailer.mp4"), "new-trailer", "utf8");
    await writeFile(outputActorPath, "new-actor", "utf8");

    const result = await resolver.resolve({
      entry,
      plan,
      outputVideoPath: plan.targetVideoPath,
      preferredAssets: {
        thumb: join(plan.outputDir, "thumb.jpg"),
        sceneImages: [outputScenePath],
        trailer: join(plan.outputDir, "trailer.mp4"),
      },
      preparedActorPhotoPaths: [outputActorPath],
    });

    expect(result.assets).toEqual({
      thumb: join(plan.outputDir, "thumb.jpg"),
      poster: undefined,
      fanart: undefined,
      sceneImages: [outputScenePath],
      trailer: join(plan.outputDir, "trailer.mp4"),
      actorPhotos: [outputActorPath],
    });
    await expect(readFile(join(plan.outputDir, "thumb.jpg"), "utf8")).resolves.toBe("new-thumb");
    await expect(readFile(outputScenePath, "utf8")).resolves.toBe("new-scene");
    await expect(readFile(join(plan.outputDir, "trailer.mp4"), "utf8")).resolves.toBe("new-trailer");
    await expect(readFile(outputActorPath, "utf8")).resolves.toBe("new-actor");
    await expect(readFile(thumbPath, "utf8")).rejects.toThrow();
    await expect(readFile(sceneImagePath, "utf8")).rejects.toThrow();
    await expect(readFile(trailerPath, "utf8")).rejects.toThrow();
    await expect(readFile(actorPhotoPath, "utf8")).rejects.toThrow();
  });
});
