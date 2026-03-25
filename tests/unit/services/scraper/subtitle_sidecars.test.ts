import type { Dirent } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSubtitleSidecarTargetPath,
  findSubtitleSidecars,
  getPreferredSubtitleTagFromSidecars,
} from "@main/services/scraper/subtitleSidecars";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readdir: vi.fn(actual.readdir),
    stat: vi.fn(actual.stat),
  };
});

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await fsPromises.mkdtemp(join(tmpdir(), "mdcz-subtitle-sidecars-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("subtitleSidecars", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => fsPromises.rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("distinguishes unlabeled and Chinese subtitle sidecars", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");
    await fsPromises.writeFile(videoPath, "video");
    await fsPromises.writeFile(join(root, "ABC-123.srt"), "subtitle");
    await fsPromises.writeFile(join(root, "ABC-123-C.srt"), "subtitle");
    await fsPromises.writeFile(join(root, "ABC-123.zh.ass"), "subtitle");
    await fsPromises.writeFile(join(root, "ABC-123.sc.vtt"), "subtitle");

    const sidecars = await findSubtitleSidecars(videoPath);

    expect(sidecars).toHaveLength(4);
    expect(sidecars.map((sidecar) => sidecar.subtitleTag).sort()).toEqual(["中文字幕", "中文字幕", "中文字幕", "字幕"]);
    expect(getPreferredSubtitleTagFromSidecars(sidecars)).toBe("中文字幕");
  });

  it("does not bind shared partless subtitles to multipart video files", async () => {
    const root = await createTempDir();
    const partVideoPath = join(root, "ABC-123-cd1.mp4");
    await fsPromises.writeFile(partVideoPath, "video");
    await fsPromises.writeFile(join(root, "ABC-123.srt"), "subtitle");
    await fsPromises.writeFile(join(root, "ABC-123-cd1.zh.srt"), "subtitle");

    const sidecars = await findSubtitleSidecars(partVideoPath);

    expect(sidecars).toHaveLength(1);
    expect(sidecars[0]?.path).toBe(join(root, "ABC-123-cd1.zh.srt"));
    const matchedSidecar = sidecars[0];
    if (!matchedSidecar) {
      throw new Error("Expected multipart subtitle sidecar to be discovered");
    }
    expect(buildSubtitleSidecarTargetPath(matchedSidecar, join(root, "OUT-001-cd1.mp4"))).toBe(
      join(root, "OUT-001-cd1.zh.srt"),
    );
  });

  it("recognizes subtitle symlinks that point to real files", async () => {
    const root = await createTempDir();
    const videoPath = join(root, "ABC-123.mp4");
    const subtitleLinkPath = join(root, "ABC-123.zh.srt");

    const fakeDirent = {
      name: "ABC-123.zh.srt",
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
    } as Dirent;
    vi.mocked(fsPromises.readdir).mockResolvedValue([fakeDirent] as unknown as Awaited<
      ReturnType<typeof fsPromises.readdir>
    >);
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isFile: () => true,
    } as Awaited<ReturnType<typeof fsPromises.stat>>);

    const sidecars = await findSubtitleSidecars(videoPath);

    expect(sidecars).toHaveLength(1);
    expect(sidecars[0]?.path).toBe(subtitleLinkPath);
    expect(sidecars[0]?.subtitleTag).toBe("中文字幕");
  });
});
