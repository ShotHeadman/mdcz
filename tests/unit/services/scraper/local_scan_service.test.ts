import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("returns no entries when a directory only contains generated trailer sidecars", async () => {
    const root = await createTempDir();

    await writeFile(join(root, "trailer.mp4"), "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toEqual([]);
  });

  it("scans only the selected files in selected-file maintenance scans", async () => {
    const root = await createTempDir();
    const selectedPath = join(root, "ABC-123.mp4");
    const skippedPath = join(root, "DEF-456.mp4");
    const trailerPath = join(root, "trailer.mp4");

    await writeFile(selectedPath, "video");
    await writeFile(skippedPath, "video");
    await writeFile(trailerPath, "trailer");

    const entries = await new LocalScanService().scanFiles([selectedPath, trailerPath], "extrafanart");

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

  it("skips FC2 feature sidecars and prefers the multipart base NFO over movie.nfo", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "FC2-123456");
    const partPath = join(movieDir, "FC2-123456-cd1.mp4");
    const featurePath = join(movieDir, "FC2-123456-花絮.mp4");
    const multipartNfoPath = join(movieDir, "FC2-123456.nfo");
    const partNfoPath = join(movieDir, "FC2-123456-cd1.nfo");
    const movieNfoPath = join(movieDir, "movie.nfo");

    await mkdir(movieDir, { recursive: true });
    await writeFile(partPath, "video");
    await writeFile(featurePath, "feature");
    await writeFile(multipartNfoPath, "<movie />");
    await writeFile(partNfoPath, "<movie />");
    await writeFile(movieNfoPath, "<movie />");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileInfo.filePath).toBe(partPath);
    expect(entries[0]?.nfoPath).toBe(multipartNfoPath);
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
