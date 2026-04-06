import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
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

  it("returns no entries when a directory only contains generated trailer sidecars", async () => {
    const root = await createTempDir();

    await writeFile(join(root, "trailer.mp4"), "trailer");

    const entries = await new LocalScanService().scan(root, "extrafanart");

    expect(entries).toEqual([]);
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
});
