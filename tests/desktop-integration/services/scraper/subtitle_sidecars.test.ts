import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSubtitleSidecarTargetPath,
  DirectoryInventory,
  FileOrganizer,
  findSubtitleSidecars,
  resolveFileInfoWithSubtitles,
} from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("sidecar inventory", () => {
  it("shares discovery listings across member layouts without binding partless subtitles to parts", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "mdcz-sidecars-"));
    tempDirs.push(directory);
    const videos = ["FC2-1234567-cd1.mp4", "FC2-1234567-cd2.mp4"].map((name) => join(directory, name));
    for (const path of [
      ...videos,
      join(directory, "FC2-1234567.srt"),
      join(directory, "FC2-1234567-cd1.zh.srt"),
      join(directory, "FC2-1234567-gift.mp4"),
      join(directory, "unrelated.txt"),
    ])
      await fs.writeFile(path, "content");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const inventory = new DirectoryInventory();
    inventory.observeDirectory(directory, directory, entries);
    const listing = vi.spyOn(fs, "readdir");
    const stats = vi.spyOn(fs, "stat");
    const organizer = new FileOrganizer();
    for (const [index, video] of videos.entries()) {
      const resolved = await resolveFileInfoWithSubtitles(video, { inventory });
      expect(resolved.subtitleSidecars.map((sidecar) => sidecar.path)).toEqual(
        index === 0 ? [join(directory, "FC2-1234567-cd1.zh.srt")] : [],
      );
      const layout = await organizer.resolveOutputPlan(
        {
          outputDir: directory,
          metadataDir: directory,
          mode: "preserve",
          targetVideoPath: video,
          nfoPath: join(directory, "movie.nfo"),
          renameSubtitles: false,
        },
        video,
        { inventory, subtitleSidecars: resolved.subtitleSidecars },
      );
      expect(
        layout.sidecars.filter((sidecar) => sidecar.kind === "feature").map((sidecar) => sidecar.sourcePath),
      ).toEqual([join(directory, "FC2-1234567-gift.mp4")]);
      if (index === 0)
        expect(buildSubtitleSidecarTargetPath(resolved.subtitleSidecars[0], join(directory, "OUT-001-cd1.mp4"))).toBe(
          join(directory, "OUT-001-cd1.zh.srt"),
        );
    }
    expect(listing).not.toHaveBeenCalled();
    expect(stats).not.toHaveBeenCalled();
  });

  it("shares alias observations while preserving separate hard-link and symlink entries", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "mdcz-sidecars-"));
    tempDirs.push(directory);
    const source = join(directory, "media");
    const alias = join(directory, "alias");
    await fs.mkdir(source);
    await fs.symlink(source, alias, "dir");
    const subtitle = join(source, "subtitle.txt");
    const hardlink = join(source, "ABC-123.zh.srt");
    const symlink = join(source, "ABC-456.zh.srt");
    await fs.writeFile(subtitle, "subtitle");
    await fs.link(subtitle, hardlink);
    await fs.symlink(subtitle, symlink);
    await fs.writeFile(join(source, "movie.nfo"), "<movie><title>Local title</title><num>ABC-123</num></movie>");
    const listing = vi.spyOn(fs, "readdir");
    const stats = vi.spyOn(fs, "stat");
    const reads = vi.spyOn(fs, "readFile");
    const inventory = new DirectoryInventory();
    const directories = await Promise.all([inventory.entries(source), inventory.entries(alias)]);
    expect(directories[0]).toBe(directories[1]);
    expect(listing).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    const snapshots = await Promise.all([
      inventory.loadNfo(join(source, "movie.nfo")),
      inventory.loadNfo(join(alias, "movie.nfo")),
    ]);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[0]?.crawlerData.title).toBe("Local title");
    expect(reads).toHaveBeenCalledOnce();
    const facts = await Promise.all(
      [subtitle, hardlink, symlink, join(alias, "subtitle.txt")].map((path) => inventory.stats(path)),
    );
    expect(facts[0]).toBe(facts[3]);
    expect(new Set(facts.map((fact) => fact.ino)).size).toBe(1);
    expect(stats).toHaveBeenCalledTimes(3);
    for (const [video, expectedSubtitle] of [
      ["ABC-123.mp4", hardlink],
      ["ABC-456.mp4", symlink],
    ]) {
      const sidecars = await findSubtitleSidecars(join(source, video), inventory);
      expect(sidecars.map((sidecar) => sidecar.path)).toEqual([expectedSubtitle]);
      expect(sidecars[0].subtitleTag).toBe("中文字幕");
    }
    expect(stats).toHaveBeenCalledTimes(3);
    expect(listing).toHaveBeenCalledTimes(1);
  });
});
