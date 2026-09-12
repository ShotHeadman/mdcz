import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyStrmTarget,
  inspectStrmTarget,
  isStrmFile,
  mapStrmPath,
  prepareStrmMirrorContent,
  readStrmTarget,
  resolvePlayableMediaTarget,
  writeStrmTarget,
} from "@mdcz/runtime/scrape/utils/strm";
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
      resolvedPath: "/videos/ABC-123.mp4",
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

  it("creates a missing STRM file and its parent directory", async () => {
    const root = await createTempDir();
    const filePath = join(root, "metadata", "ABC-123.strm");

    await writeStrmTarget(filePath, "/videos/ABC-123.mp4");

    await expect(readFile(filePath, "utf8")).resolves.toBe("/videos/ABC-123.mp4");
  });

  it.each([
    {
      actual: "D:\\Downloads\\a\\movie.mp4",
      from: "d:/downloads/",
      to: "/mnt/downloads",
      expected: "/mnt/downloads/a/movie.mp4",
    },
    {
      actual: "\\\\server\\share\\movie.mp4",
      from: "\\\\server\\share",
      to: "Z:\\Videos",
      expected: "Z:\\Videos\\movie.mp4",
    },
    {
      actual: "/media/a/movie.mp4",
      from: "/media",
      to: "\\\\player\\share",
      expected: "\\\\player\\share\\a\\movie.mp4",
    },
    { actual: "/media-other/movie.mp4", from: "/media", to: "/target", expected: "/media-other/movie.mp4" },
    { actual: "/Media/movie.mp4", from: "/media", to: "/target", expected: "/Media/movie.mp4" },
    { actual: "/movie.mp4", from: "/", to: "/target", expected: "/target/movie.mp4" },
  ])("maps absolute paths using directory boundaries: $actual", ({ actual, from, to, expected }) => {
    expect(mapStrmPath(actual, [{ from, to }])).toBe(expected);
  });

  it("uses the longest matching STRM prefix", () => {
    expect(
      mapStrmPath("/media/long/a.mp4", [
        { from: "/media", to: "/short" },
        { from: "/media/long", to: "/long" },
      ]),
    ).toBe("/long/a.mp4");
  });

  it.each([
    "",
    "one.mp4\ntwo.mp4",
    "#EXTM3U\nmovie.mp4",
    "D:relative.mp4",
  ])("rejects unsupported mirror contents: %j", async (content) => {
    const root = await createTempDir();
    const source = join(root, "movie.strm");
    await writeFile(source, content);
    await expect(prepareStrmMirrorContent(source, source)).rejects.toThrow(/STRM/);
    expect(await readFile(source, "utf8")).toBe(content);
  });

  it("preserves URL bytes and only maps resolved local playback targets", async () => {
    const root = await createTempDir();
    const source = join(root, "movie.strm");
    const mappings = [{ from: root, to: "/player" }];
    for (const content of [
      "https://server/a%2Fb.mp4?token=A%2bB&x=1#frag",
      `../${root.split(/[\\/]/u).at(-1)}/media.mp4`,
      "media.mp4",
    ]) {
      await writeFile(source, content);
      const result = await prepareStrmMirrorContent(source, source, mappings);
      expect(result).toBe(content.startsWith("https:") ? content : "/player/media.mp4");
      expect(await readFile(source, "utf8")).toBe(content);
    }
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
