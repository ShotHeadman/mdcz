import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import { MoveOutput } from "../publication/MoveOutput";
import { createMemoryPublicationJournal } from "../publication/memoryJournal";
import { prepareMovieArtifacts } from "../publication/movieArtifacts";
import { toRootFileRef } from "../publication/outputRefs";
import { WriteOutput } from "../publication/WriteOutput";
import { confirmUncensoredOutputs, type UncensoredConfirmDependencies } from "./confirmUncensored";
import { DirectoryInventory } from "./DirectoryInventory";
import { FileOrganizer, type OrganizePlan } from "./FileOrganizer";
import { NfoGenerator } from "./nfo";
import { parseFileInfo } from "./utils/number";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-confirm-"));
  directories.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  const metadata = join(root, "metadata");
  await Promise.all([mkdir(source), mkdir(output), mkdir(metadata)]);
  const nfoPath = join(source, "FC2-123456.nfo");
  const data: CrawlerData = {
    title: "Multipart",
    number: "FC2-123456",
    actors: [],
    genres: ["无码"],
    scene_images: [],
    website: Website.FC2,
  };
  const files = [
    "FC2-123456-CD1.mp4",
    "FC2-123456-CD2.mp4",
    "FC2-123456-CD1.zh.srt",
    "FC2-123456-CD2.ass",
    "FC2-123456-花絮.mp4",
    "poster.jpg",
    "FC2-123456.nfo",
    "movie.nfo",
  ];
  for (const file of files)
    await writeFile(join(source, file), file.endsWith(".nfo") ? "<movie><title>Original</title></movie>" : file);
  const items = [1, 2].map((part) => {
    const videoPath = join(source, `FC2-123456-CD${part}.mp4`);
    return {
      groupId: "movie-1",
      fileId: buildFileId(videoPath),
      videoPath,
      nfoPath,
      metadataVideoPath: join(metadata, `FC2-123456-CD${part}.strm`),
      crawlerData: data,
      choice: "leak" as const,
    };
  });
  for (const item of items) await writeFile(item.metadataVideoPath, item.videoPath);

  const journal = createMemoryPublicationJournal();
  const mediaRoot = { id: "root", hostPath: root };
  const generator = new NfoGenerator();
  const organizer = new FileOrganizer();
  const deps: UncensoredConfirmDependencies = {
    fileOrganizer: {
      plan: vi.fn(
        (info): OrganizePlan => ({
          outputDir: output,
          metadataDir: metadata,
          mode: "move",
          targetVideoPath: join(output, `${info.fileName}-leak.mp4`),
          nfoPath: join(metadata, "FC2-123456-leak.nfo"),
          strmPath: join(metadata, `${info.fileName}-leak.strm`),
          renameSubtitles: true,
        }),
      ),
      resolveOutputPlan: organizer.resolveOutputPlan.bind(organizer),
    },
    localScanService: {
      scanVideo: vi.fn(
        async (_root, videoPath): Promise<LocalScanEntry> => ({
          fileId: buildFileId(videoPath),
          ref: { rootId: "root", relativePath: parse(videoPath).base },
          fileInfo: { ...parseFileInfo(videoPath), isSubtitled: true, subtitleTag: "中文字幕" },
          nfoPath,
          strmPath: join(metadata, `${parse(videoPath).name}.strm`),
          crawlerData: data,
          assets: { poster: join(source, "poster.jpg"), actorPhotos: [], sceneImages: [] },
          currentDir: source,
        }),
      ),
    },
    nfoGenerator: { writeNfo: vi.fn(generator.writeNfo.bind(generator)) },
    pathExists: async (path) =>
      readFile(path).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ),
    logger: { info: vi.fn(), warn: vi.fn() },
    preparePublication: vi.fn(
      async ({
        operationId,
        members,
        nfoNaming,
        writeNfo,
      }: Parameters<UncensoredConfirmDependencies["preparePublication"]>[0]) => {
        const prepared = await prepareMovieArtifacts({
          inventory: new DirectoryInventory(),
          roots: [mediaRoot],
          members: await Promise.all(
            members.map(async (member) => ({
              fileId: member.item.fileId,
              layout: member.layout,
              existingAssets: member.entry.assets,
              existingNfoPath: member.existingNfoPath,
              assetLayout: await resolvePublicationAssetLayout({
                layout: member.layout,
                config: defaultConfiguration,
                existingAssets: member.entry.assets,
              }),
              source: toRootFileRef(member.layout.sourceVideoPath, [mediaRoot]),
            })),
          ),
          downloadedAssets: { downloaded: [], sceneImages: [] },
          actorPhotoPaths: [],
          nfoNaming,
          writeNfo,
        });
        return {
          ...prepared,
          output: { ...prepared, movieId: "movie-1", operationId, operationType: "maintenance" as const },
          resolve: (ref: { rootId: string; relativePath: string }) => join(root, ref.relativePath),
        };
      },
    ),
    publish: vi.fn(async ({ output }) => {
      const commit = () => undefined;
      if (output.moves.length)
        await new MoveOutput().install({
          operationId: output.operationId,
          operationType: output.operationType,
          moves: output.moves,
          artifacts: output.artifacts,
          journal,
          commit,
        });
      else await new WriteOutput().install(output.artifacts, { commit });
    }),
  };
  return { source, output, metadata, items, deps, journal };
};

describe("confirmUncensoredOutputs", () => {
  it.each([
    { failure: false, distinctLocations: false },
    { failure: true, distinctLocations: false },
    { failure: false, distinctLocations: true },
    { failure: true, distinctLocations: true },
  ])("publishes shared NFO, subtitles, STRM and FC2 features as one batch ($failure, $distinctLocations)", async ({
    failure,
    distinctLocations,
  }) => {
    const { source, output, metadata, items, deps, journal } = await fixture();
    const otherMetadata = join(metadata, "second");
    if (distinctLocations) {
      await mkdir(otherMetadata);
      const originalPlan = deps.fileOrganizer.plan;
      deps.fileOrganizer.plan = vi.fn((...args: Parameters<typeof originalPlan>) => {
        const plan = originalPlan(...args);
        if (!args[0].fileName.includes("CD2")) return plan;
        return {
          ...plan,
          metadataDir: otherMetadata,
          nfoPath: join(otherMetadata, "FC2-123456-leak.nfo"),
          strmPath: join(otherMetadata, `${args[0].fileName}-leak.strm`),
        };
      });
    }
    if (failure)
      journal.commit = () => {
        throw new Error("commit failure");
      };
    const result = await confirmUncensoredOutputs(items, defaultConfiguration, deps);
    expect(deps.nfoGenerator.writeNfo).toHaveBeenCalledTimes(1);
    expect(deps.nfoGenerator.writeNfo).toHaveBeenCalledWith(
      join(metadata, "FC2-123456-leak.nfo"),
      expect.anything(),
      expect.objectContaining({
        fileInfo: expect.objectContaining({ isSubtitled: true, subtitleTag: "中文字幕", part: undefined }),
        localState: { uncensoredChoice: "leak" },
      }),
    );
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(journal.listUnfinished()).toEqual([]);
    expect(result.updatedCount).toBe(failure ? 0 : 2);
    expect(result.failures).toHaveLength(failure ? 2 : 0);
    for (const item of items) {
      if (failure) {
        expect(await readFile(item.videoPath, "utf8")).toBe(parse(item.videoPath).base);
        expect(await readFile(item.nfoPath, "utf8")).toContain("Original");
        expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      } else {
        const target = join(output, `${parse(item.videoPath).name}-leak.mp4`);
        expect(await readFile(target, "utf8")).toBe(parse(item.videoPath).base);
        const itemMetadata = distinctLocations && item.videoPath.includes("CD2") ? otherMetadata : metadata;
        expect(await readFile(join(itemMetadata, `${parse(item.videoPath).name}-leak.strm`), "utf8")).toBe(target);
        expect(result.items.find((update) => update.fileId === item.fileId)?.targetNfoPath).toBe(
          join(itemMetadata, "FC2-123456-leak.nfo"),
        );
        await expect(readFile(item.videoPath)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      }
    }
    for (const [original, renamed] of [
      ["FC2-123456-CD1.zh.srt", "FC2-123456-CD1-leak.zh.srt"],
      ["FC2-123456-CD2.ass", "FC2-123456-CD2-leak.ass"],
      ["FC2-123456-花絮.mp4", "FC2-123456-leak-花絮.mp4"],
    ]) {
      expect(await readFile(join(failure ? source : output, failure ? original : renamed), "utf8")).toBe(original);
    }
    if (!failure) {
      expect(await readFile(join(metadata, "poster.jpg"), "utf8")).toBe("poster.jpg");
      if (distinctLocations) {
        expect(await readFile(join(otherMetadata, "poster.jpg"), "utf8")).toBe("poster.jpg");
        expect(await readFile(join(otherMetadata, "FC2-123456-leak.nfo"), "utf8")).toBe(
          await readFile(join(metadata, "FC2-123456-leak.nfo"), "utf8"),
        );
      }
      expect(await readFile(join(source, "movie.nfo"), "utf8")).toContain("Original");
    }
    const [{ output: preparedOutput }] = vi.mocked(deps.publish).mock.calls[0];
    expect(preparedOutput.files).toHaveLength(items.length);
    const targets = [
      ...preparedOutput.moves.map((move) => move.target.relativePath),
      ...preparedOutput.artifacts.map((artifact) => artifact.targetPath),
    ];
    expect(new Set(targets).size).toBe(targets.length);
    expect(
      new Set(preparedOutput.movieAssets.map((asset) => (asset.type === "local" ? asset.file.relativePath : asset.url)))
        .size,
    ).toBe(preparedOutput.movieAssets.length);
  });

  it.each([
    "missing-video",
    "disabled-nfo",
  ])("requires media but does not require NFO ownership: %s", async (scenario) => {
    const { items, deps } = await fixture();
    const config = structuredClone(defaultConfiguration);
    if (scenario === "missing-video") await rm(items[0].videoPath);
    else {
      config.download.generateNfo = false;
      const scanned = await deps.localScanService.scanVideo(
        { id: "root", hostPath: "", realPath: null, displayName: "", createdAt: new Date(), updatedAt: new Date() },
        items[0].videoPath,
        "extrafanart",
      );
      vi.mocked(deps.localScanService.scanVideo).mockResolvedValue({ ...scanned, nfoPath: undefined });
    }
    const result = await confirmUncensoredOutputs(
      [{ ...items[0], nfoPath: scenario === "disabled-nfo" ? undefined : items[0].nfoPath }],
      config,
      deps,
    );
    if (scenario === "missing-video") {
      expect(result.updatedCount).toBe(0);
      expect(result.failures[0].message).toContain("output files not found");
      expect(deps.publish).not.toHaveBeenCalled();
    } else {
      expect(result.failures).toEqual([]);
      expect(result.updatedCount).toBe(1);
      expect(result.items[0].targetNfoPath).toBeUndefined();
      expect(vi.mocked(deps.publish).mock.calls[0][0].output.files[0].assets.map((asset) => asset.kind)).toContain(
        "strm",
      );
      expect(deps.nfoGenerator.writeNfo).not.toHaveBeenCalled();
    }
  });

  it("rejects multipart main-video conflicts without changing paths or shared resources", async () => {
    const { source, output, metadata, items, deps } = await fixture();
    for (const item of items) {
      const base = `${parse(item.videoPath).name}-leak`;
      await writeFile(join(output, `${base}.mp4`), `old-${base}`);
      await writeFile(join(output, `${base}${item.videoPath.includes("CD1") ? ".zh.srt" : ".ass"}`), `old-subtitle`);
    }

    const result = await confirmUncensoredOutputs(items, defaultConfiguration, deps);

    expect(result.updatedCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(2);
    for (const item of items) {
      const base = `${parse(item.videoPath).name}-leak`;
      expect(await readFile(item.videoPath, "utf8")).toBe(parse(item.videoPath).base);
      expect(await readFile(join(output, `${base}.mp4`), "utf8")).toBe(`old-${base}`);
      expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      expect(await readFile(item.nfoPath, "utf8")).toContain("Original");
      await expect(readFile(join(output, `${base} (1).mp4`))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(join(source, "FC2-123456-花絮.mp4"), "utf8")).toBe("FC2-123456-花絮.mp4");
    expect(await readFile(join(source, "poster.jpg"), "utf8")).toBe("poster.jpg");
    await expect(readFile(join(metadata, "FC2-123456-leak.nfo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects conflicting choices for a registered movie before preparing output", async () => {
    const { items, deps } = await fixture();
    await expect(
      confirmUncensoredOutputs([items[0], { ...items[1], choice: "umr" }], defaultConfiguration, deps),
    ).rejects.toThrow("同一影片不能选择不同的无码类型");
    expect(deps.nfoGenerator.writeNfo).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
});
