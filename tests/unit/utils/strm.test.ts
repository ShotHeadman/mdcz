import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyStrmTarget,
  inspectStrmTarget,
  isStrmFile,
  readStrmTarget,
  resolvePlayableMediaTarget,
  writeStrmTarget,
} from "@main/utils/strm";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-strm-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("strm utils", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("recognizes .strm files case-insensitively", () => {
    expect(isStrmFile("/tmp/movie.strm")).toBe(true);
    expect(isStrmFile("/tmp/movie.STRM")).toBe(true);
    expect(isStrmFile("/tmp/movie.mp4")).toBe(false);
  });

  it("reads the first non-empty target line from a .strm file", async () => {
    const root = await createTempDir();
    const filePath = join(root, "ABC-123.strm");
    await writeFile(
      filePath,
      "\uFEFF\n\n#KODIPROP:rtsp_transport=tcp\n  https://example.com/stream.m3u8  \n/path/ignored",
      "utf8",
    );

    await expect(readStrmTarget(filePath)).resolves.toBe("https://example.com/stream.m3u8");
  });

  it("classifies relative, absolute, and url targets", () => {
    expect(classifyStrmTarget("/library/ABC-123.strm", "../videos/ABC-123.mp4")).toEqual({
      target: "../videos/ABC-123.mp4",
      kind: "relative_path",
      resolvedPath: resolve("/library", "../videos/ABC-123.mp4"),
    });
    expect(classifyStrmTarget("/library/ABC-123.strm", "/videos/ABC-123.mp4")).toEqual({
      target: "/videos/ABC-123.mp4",
      kind: "absolute_path",
      resolvedPath: "/videos/ABC-123.mp4",
    });
    expect(classifyStrmTarget("/library/ABC-123.strm", "https://example.com/stream.m3u8")).toEqual({
      target: "https://example.com/stream.m3u8",
      kind: "url",
    });
  });

  it("resolves relative .strm targets for playback", async () => {
    const root = await createTempDir();
    const nestedDir = join(root, "library", "movie");
    const filePath = join(nestedDir, "ABC-123.strm");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(filePath, "../videos/ABC-123.mp4", "utf8");

    await expect(inspectStrmTarget(filePath)).resolves.toEqual({
      target: "../videos/ABC-123.mp4",
      kind: "relative_path",
      resolvedPath: resolve(nestedDir, "../videos/ABC-123.mp4"),
    });
    await expect(resolvePlayableMediaTarget(filePath)).resolves.toEqual({
      kind: "path",
      target: resolve(nestedDir, "../videos/ABC-123.mp4"),
    });
  });

  it("throws when a .strm file does not contain a playable target", async () => {
    const root = await createTempDir();
    const filePath = join(root, "ABC-123.strm");
    await writeFile(filePath, "   \n  ", "utf8");

    await expect(resolvePlayableMediaTarget(filePath)).rejects.toThrow(
      `STRM file does not contain a playable target: ${filePath}`,
    );
  });

  it("rewrites the target line while preserving KODIPROP headers", async () => {
    const root = await createTempDir();
    const filePath = join(root, "ABC-123.strm");
    await writeFile(filePath, "\uFEFF#KODIPROP:rtsp_transport=tcp\n../videos/ABC-123.mp4\n", "utf8");

    await writeStrmTarget(filePath, "/videos/ABC-123.mp4");

    await expect(readStrmTarget(filePath)).resolves.toBe("/videos/ABC-123.mp4");
    await expect(readFile(filePath, "utf8")).resolves.toBe("\uFEFF#KODIPROP:rtsp_transport=tcp\n/videos/ABC-123.mp4\n");
  });

  it("rejects Kodi-only url schemes for desktop playback", async () => {
    const root = await createTempDir();
    const filePath = join(root, "ABC-123.strm");
    await writeFile(filePath, "plugin://plugin.video.youtube/play/?video_id=test", "utf8");

    await expect(resolvePlayableMediaTarget(filePath)).rejects.toThrow(
      "Desktop playback does not support STRM target protocol: plugin://",
    );
  });
});
