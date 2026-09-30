import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-local-scan-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("LocalScanService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("skips generated trailer sidecars when scanning for maintenance entries", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "ABC-123");
    const videoPath = join(movieDir, "ABC-123.mp4");
    const trailerPath = join(movieDir, "trailer.mp4");

    await mkdir(movieDir, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(trailerPath, "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(videoPath);
    expect(entries[0]?.assets.trailer).toBe(trailerPath);
  });

  it("skips follow-video trailer sidecars and keeps them attached as trailer assets", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "ABC-123");
    const videoPath = join(movieDir, "ABC-123.mp4");
    const trailerPath = join(movieDir, "ABC-123-trailer.mp4");

    await mkdir(movieDir, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(trailerPath, "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(videoPath);
    expect(entries[0]?.assets.trailer).toBe(trailerPath);
  });

  it("uses registered metadata paths after settings change", async () => {
    const root = await createTempDir();
    const source = join(root, "source");
    const metadata = join(root, "metadata");
    await Promise.all([mkdir(source), mkdir(metadata)]);
    const video = join(source, "ABC-123-original.mp4");
    const nfo = join(metadata, "ABC-123-template.nfo");
    await writeFile(video, "video");
    await writeFile(join(source, "DEF-456.mp4"), "another video");
    await writeFile(join(metadata, "poster.jpg"), "poster");
    await writeFile(
      nfo,
      '<movie><num>ABC-123</num><title>Registered</title><thumb aspect="poster">poster.jpg</thumb></movie>',
    );
    const mediaRoot = {
      id: "root",
      hostPath: root,
      realPath: null,
      displayName: "root",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const locations = {
      mediaPath: "/changed",
      metadataPath: "/changed-metadata",
      registeredOutputs: new Map([
        [
          video,
          {
            nfoPath: nfo,
            assets: { poster: join(metadata, "poster.jpg"), sceneImages: [], actorPhotos: [] },
          },
        ],
      ]),
    };
    const scanner = new LocalScanService();
    expect(
      (await scanner.scan(mediaRoot, "extrafanart", undefined, locations))
        .map((entry) => entry.fileInfo.filePath)
        .sort(),
    ).toEqual([video, join(source, "DEF-456.mp4")].sort());
    const [entry] = await scanner.scanFiles(mediaRoot, [video], "extrafanart", undefined, locations);
    expect(entry).toMatchObject({
      nfoPath: nfo,
      crawlerData: { title: "Registered" },
      assets: { poster: join(metadata, "poster.jpg") },
    });
    await rm(nfo);
    await writeFile(join(source, "movie.nfo"), "source metadata");
    const [missing] = await scanner.scanFiles(mediaRoot, [video], "extrafanart", undefined, locations);
    expect(missing.nfoPath).toBe(nfo);
    expect(missing.scanError).toContain("NFO");
  });

  it("scans only the selected files in selected-file maintenance scans", async () => {
    const root = await createTempDir();
    const selectedPath = join(root, "ABC-123.mp4");
    const skippedPath = join(root, "DEF-456.mp4");
    const trailerPath = join(root, "trailer.mp4");

    await writeFile(selectedPath, "video");
    await writeFile(skippedPath, "video");
    await writeFile(trailerPath, "trailer");

    const scanner = new LocalScanService();
    const entries = await scanner.scanFiles([selectedPath], "extrafanart");
    await expect(scanner.scanFiles([trailerPath], "extrafanart")).rejects.toThrow(trailerPath);
    await expect(scanner.scanFiles([join(root, "missing.mp4")], "extrafanart")).rejects.toThrow("missing.mp4");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(selectedPath);
    expect(entries.some((entry) => entry.fileInfo.filePath === skippedPath)).toBe(false);
  });

  it("keeps external NFO metadata and assets when its source website is unknown", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "ABP-123");
    const videoPath = join(movieDir, "ABP-123.mp4");
    const nfoPath = join(movieDir, "ABP-123.nfo");
    const posterPath = join(movieDir, "poster.jpg");

    await mkdir(movieDir, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(posterPath, "poster");
    await writeFile(
      nfoPath,
      `
        <movie>
          <title>External Metadata</title>
          <num>ABP-123</num>
          <thumb aspect="poster">poster.jpg</thumb>
        </movie>
      `,
    );

    const [entry] = await new LocalScanService().scan(root, "extrafanart");

    expect(entry?.scanError).toBeUndefined();
    expect(entry?.crawlerData).toMatchObject({
      title: "External Metadata",
      number: "ABP-123",
      poster_url: "poster.jpg",
    });
    expect(entry?.crawlerData?.website).toBeUndefined();
    expect(entry?.assets.poster).toBe(posterPath);
  });

  it("selects regular and symlink NFOs by priority for multipart movies without sharing ambiguous metadata", async () => {
    const root = await createTempDir();
    const xml = "<movie><num>FC2-123456</num><title>Local metadata</title></movie>";
    const linkedMetadata = join(root, "metadata.xml");
    await writeFile(linkedMetadata, xml);

    for (const linked of [false, true]) {
      const movieDir = join(root, linked ? "linked" : "regular");
      await mkdir(movieDir);
      const partPaths = [1, 2].map((part) => join(movieDir, `FC2-123456-cd${part}.mp4`));
      for (const partPath of partPaths) await writeFile(partPath, "video");
      await writeFile(join(movieDir, "FC2-123456-花絮.mp4"), "feature");
      const nfoPaths = ["FC2-123456.nfo", "FC2-123456-cd1.nfo", "movie.nfo", "external.NFO"].map((name) =>
        join(movieDir, name),
      );
      for (const nfoPath of nfoPaths) {
        if (linked) await symlink(linkedMetadata, nfoPath, "file");
        else await writeFile(nfoPath, xml);
      }

      const scanner = new LocalScanService();
      for (const [index, nfoPath] of nfoPaths.entries()) {
        const entries = await scanner.scan(movieDir, "extrafanart");
        expect(entries.map((entry) => entry.fileInfo.filePath).sort()).toEqual(partPaths);
        for (const entry of entries) {
          const expectedNfo = index === 1 && entry.fileInfo.filePath === partPaths[1] ? nfoPaths[2] : nfoPath;
          expect(entry.nfoPath).toBe(expectedNfo);
          expect(entry.scanError).toBeUndefined();
          expect(entry.crawlerData?.title).toBe("Local metadata");
        }

        if (index >= 2) {
          const unrelatedVideo = join(movieDir, "ABC-123.mp4");
          await writeFile(unrelatedVideo, "other movie");
          const sharedEntries = await scanner.scan(movieDir, "extrafanart");
          expect(sharedEntries).toHaveLength(3);
          for (const entry of sharedEntries) expect(entry.nfoPath).toBeUndefined();
          await rm(unrelatedVideo);
        }
        await rm(nfoPath);
      }
    }
  });

  it("does not treat non-FC2 files with feature keywords as generated sidecars", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123-特典.mp4");

    await writeFile(videoPath, "video");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(videoPath);
  });

  it("marks videos as subtitled when a matching external subtitle file exists", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "ABC-123");
    const videoPath = join(movieDir, "ABC-123.mp4");
    const subtitlePath = join(movieDir, "ABC-123.zh.srt");

    await mkdir(movieDir, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(subtitlePath, "subtitle");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(videoPath);
    expect(entries[0]?.fileInfo.isSubtitled).toBe(true);
    expect(entries[0]?.fileInfo.subtitleTag).toBe("中文字幕");
  });

  it("prefers follow-video artwork and ignores ambiguous fixed artwork in shared directories", async () => {
    const root = await createTempDir();
    const actorDir = join(root, "Actor A");
    const firstVideoPath = join(actorDir, "ABC-123.mp4");
    const secondVideoPath = join(actorDir, "DEF-456.mp4");
    const firstPosterPath = join(actorDir, "ABC-123-poster.jpg");
    const ambiguousPosterPath = join(actorDir, "poster.jpg");

    await mkdir(actorDir, { recursive: true });
    await writeFile(firstVideoPath, "video-a");
    await writeFile(secondVideoPath, "video-b");
    await writeFile(firstPosterPath, "poster-a");
    await writeFile(ambiguousPosterPath, "poster-shared");

    const entries = await new LocalScanService().scan(root, "extrafanart");
    const firstEntry = entries.find((entry) => entry.fileInfo.filePath === firstVideoPath);
    const secondEntry = entries.find((entry) => entry.fileInfo.filePath === secondVideoPath);

    expect(firstEntry?.assets.poster).toBe(firstPosterPath);
    expect(secondEntry?.assets.poster).toBeUndefined();
  });

  it("keeps shared .actors photos discoverable even when multiple movies share a directory", async () => {
    const root = await createTempDir();
    const actorDir = join(root, "Actor A");
    const firstVideoPath = join(actorDir, "ABC-123.mp4");
    const secondVideoPath = join(actorDir, "DEF-456.mp4");
    const actorPhotoPath = join(actorDir, ".actors", "Actor A.jpg");

    await mkdir(join(actorDir, ".actors"), { recursive: true });
    await writeFile(firstVideoPath, "video-a");
    await writeFile(secondVideoPath, "video-b");
    await writeFile(actorPhotoPath, "actor-a");

    const entries = await new LocalScanService().scan(root, "extrafanart");
    const firstEntry = entries.find((entry) => entry.fileInfo.filePath === firstVideoPath);
    const secondEntry = entries.find((entry) => entry.fileInfo.filePath === secondVideoPath);

    expect(firstEntry?.assets.actorPhotos).toEqual([actorPhotoPath]);
    expect(secondEntry?.assets.actorPhotos).toEqual([actorPhotoPath]);
  });
});
