import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MoveOutput, WriteOutput } from "@mdcz/runtime/publication";
import { prepareMovieArtifacts } from "@mdcz/runtime/publication/movieArtifacts";
import { toRootFileRef } from "@mdcz/runtime/publication/outputRefs";
import { FileOrganizer, type ResolvedPublicationLayout } from "@mdcz/runtime/scrape";
import { DirectoryInventory } from "@mdcz/runtime/scrape/DirectoryInventory";
import type { Configuration } from "@mdcz/shared/config";
import type { PlacementMode } from "@mdcz/shared/mediaLibrary";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrganizerConfig as createConfig,
  createOrganizerCrawlerData as createCrawlerData,
  createOrganizerFileInfo as createFileInfo,
} from "../../../unit/services/scraper/file_organizer.testSupport";

const tempDirs: string[] = [];
const publicationFs = { ...fs };

const publishVideo = async (
  fileInfo: ReturnType<typeof createFileInfo>,
  plan: ResolvedPublicationLayout,
  config: Configuration,
): Promise<string> => {
  const roots = tempDirs.map((hostPath) => ({ id: hostPath, hostPath }));
  const source = toRootFileRef(fileInfo.filePath, roots);
  const output = await prepareMovieArtifacts({
    inventory: new DirectoryInventory(),
    roots,
    members: [{ source, fileId: randomUUID(), layout: plan, assetLayout: { staged: new Map(), retained: new Map() } }],
    downloadedAssets: { downloaded: [], sceneImages: [] },
    actorPhotoPaths: [],
    nfoNaming: config.download.nfoNaming,
    writeNfo: async () => undefined,
  });
  const commit = () => undefined;
  if (output.moves.length)
    await new MoveOutput(publicationFs).install({ moves: output.moves, artifacts: output.artifacts, commit });
  else await new WriteOutput(publicationFs).install(output.artifacts, { commit });
  return plan.targetVideoPath;
};

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-file-organizer-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const expectPathExists = async (path: string): Promise<void> => {
  await expect(access(path)).resolves.toBeUndefined();
};

const movedInto = (outputPath: string) =>
  createConfig({ target: { outputPath, folderTemplate: "{number}", fileTemplate: "{number}" } });

describe("FileOrganizer filesystem organize", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("keeps the planned target beside an occupied file and leaves in-place videos where they are", async () => {
    const root = await createTempDir();
    const collisionSourcePath = join(root, "source.mp4");
    const existingTargetPath = join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4");
    await writeFile(collisionSourcePath, "video", "utf8");
    await mkdir(dirname(existingTargetPath), { recursive: true });
    await writeFile(existingTargetPath, "existing", "utf8");

    const organizer = new FileOrganizer();
    const collisionPlan = organizer.plan(
      createFileInfo({ filePath: collisionSourcePath, fileName: "source" }),
      createCrawlerData({ number: "XYZ-999" }),
      ...movedInto(join(root, "output")),
    );
    const preparedCollision = await organizer.resolveOutputPlan(collisionPlan, collisionSourcePath);

    expect(preparedCollision.targetVideoPath).toBe(existingTargetPath);
    expect(preparedCollision.nfoPath).toBe(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.nfo"));

    const inPlaceRoot = await createTempDir();
    const sourcePath = join(inPlaceRoot, "source.mp4");
    await writeFile(sourcePath, "video", "utf8");
    const [inPlaceConfig, inPlaceTarget] = createConfig({ target: { placement: "inPlace", outputPath: "" } });
    const inPlaceFileInfo = createFileInfo({ filePath: sourcePath, fileName: "source" });
    const preparedInPlace = await organizer.resolveOutputPlan(
      organizer.plan(inPlaceFileInfo, createCrawlerData({ number: "XYZ-999" }), inPlaceConfig, inPlaceTarget),
      sourcePath,
    );

    expect(preparedInPlace.nfoPath).toBe(join(inPlaceRoot, "source.nfo"));
    expect(await publishVideo(inPlaceFileInfo, preparedInPlace, inPlaceConfig)).toBe(sourcePath);
    expect(await fs.readdir(inPlaceRoot)).toEqual(["source.mp4"]);
  });

  it.each([
    "move",
    "copy",
    "hardlink",
    "inPlace",
    "metadataOnly",
    "strm",
  ] as const satisfies readonly PlacementMode[])("publishes each placement without touching unrelated source files (%s)", async (placement) => {
    const root = await createTempDir();
    const source = join(root, "downloads", "ABC-123-original.mp4");
    const sourceDir = dirname(source);
    const libraryDir = join(root, "library", "ABC-123-CEN");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(source, "video");
    const subtitles = [".zh.forced.srt", ".en.sdh.ass", ".idx", ".sub"];
    for (const suffix of subtitles) await writeFile(join(sourceDir, `ABC-123-original${suffix}`), suffix);
    await writeFile(join(sourceDir, "movie.nfo"), "original NFO");
    await writeFile(join(sourceDir, "poster.jpg"), "original poster");
    const [config, target] = createConfig({
      target: {
        placement,
        outputPath: placement === "inPlace" ? "" : join(root, "library"),
        folderTemplate: "{number}",
        fileTemplate: "{number}",
      },
    });
    const organizer = new FileOrganizer();
    const info = createFileInfo({ filePath: source, fileName: "ABC-123-original" });
    const plan = await organizer.resolveOutputPlan(organizer.plan(info, createCrawlerData(), config, target), source);
    await publishVideo(info, plan, config);

    const placed = placement === "move" || placement === "copy" || placement === "hardlink";
    const played = placed
      ? join(libraryDir, "ABC-123-CEN.mp4")
      : placement === "strm"
        ? join(libraryDir, "ABC-123-CEN.strm")
        : source;
    expect(plan.targetVideoPath).toBe(placed ? played : source);
    expect(plan.metadataDir).toBe(placement === "inPlace" ? sourceDir : libraryDir);
    if (placement === "strm") expect(await readFile(played, "utf8")).toBe(`${source}\n`);
    else expect(await readFile(plan.targetVideoPath, "utf8")).toBe("video");
    if (placement !== "strm") await expect(access(join(libraryDir, "ABC-123-CEN.strm"))).rejects.toThrow();
    // Subtitles follow the file a media server plays, renamed to match it.
    for (const suffix of subtitles)
      expect(
        await readFile(
          join(dirname(played), `${played === source ? "ABC-123-original" : "ABC-123-CEN"}${suffix}`),
          "utf8",
        ),
      ).toBe(suffix);
    if (placement === "move") await expect(access(source)).rejects.toMatchObject({ code: "ENOENT" });
    else expect(await readFile(source, "utf8")).toBe("video");
    if (placement === "move") await expect(access(join(sourceDir, "ABC-123-original.zh.forced.srt"))).rejects.toThrow();
    else expect(await readFile(join(sourceDir, "ABC-123-original.zh.forced.srt"), "utf8")).toBe(".zh.forced.srt");
    expect(await readFile(join(sourceDir, "movie.nfo"), "utf8")).toBe("original NFO");
    expect(await readFile(join(sourceDir, "poster.jpg"), "utf8")).toBe("original poster");
  });

  it("rejects a separate output that overlaps the video's directory before creating output", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const organizer = new FileOrganizer();

    expect(() =>
      organizer.plan(
        createFileInfo({ filePath: join(mediaRoot, "ABC-123.mp4") }),
        createCrawlerData(),
        ...createConfig({ target: { placement: "metadataOnly", outputPath: join(mediaRoot, "metadata") } }),
      ),
    ).toThrow("The library output directory cannot be the same as or contain the video's directory");
    await expect(access(join(mediaRoot, "metadata"))).rejects.toThrow();
  });

  it("allows moving .strm files with KODIPROP-backed stream urls", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "library", "ABC-123.strm");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "#KODIPROP:rtsp_transport=tcp\nrtsp://example.com/live", "utf8");

    const plan = organizer.plan(
      createFileInfo({ filePath: sourcePath, fileName: "ABC-123", extension: ".strm" }),
      createCrawlerData({ number: "ABC-123" }),
      ...movedInto(join(root, "output")),
    );

    await expect(organizer.resolveOutputPlan(plan, sourcePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "output", "ABC-123-CEN", "ABC-123-CEN.strm"),
    });
  });

  it("restores an already moved video when a subsequent sidecar move fails", async () => {
    const organizer = new FileOrganizer();
    const root = await createTempDir();
    const sourcePath = join(root, "source.mp4");
    const subtitlePath = join(root, "source.zh.srt");
    await writeFile(sourcePath, "video", "utf8");
    await writeFile(subtitlePath, "subtitle", "utf8");
    const [config, target] = movedInto(join(root, "output"));
    const fileInfo = createFileInfo({ filePath: sourcePath, fileName: "source" });
    const plan = await organizer.resolveOutputPlan(
      organizer.plan(fileInfo, createCrawlerData({ number: "XYZ-999" }), config, target),
      sourcePath,
    );

    const originalRename = fs.rename;
    vi.spyOn(publicationFs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (String(toPath).endsWith(".zh.srt")) throw new Error("mock subtitle move failure");
      return originalRename(fromPath, toPath);
    });

    await expect(publishVideo(fileInfo, plan, config)).rejects.toThrow("mock");
    await expectPathExists(sourcePath);
    await expectPathExists(subtitlePath);
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.mp4"))).rejects.toThrow();
    await expect(access(join(root, "output", "XYZ-999-CEN", "XYZ-999-CEN.zh.srt"))).rejects.toThrow();
  });

  it("writes in place only into a directory that holds one movie", async () => {
    const organizer = new FileOrganizer();
    const [config, target] = createConfig({ target: { placement: "inPlace", outputPath: "" } });
    const resolveInPlace = async (files: string[], fileInfo: Partial<ReturnType<typeof createFileInfo>> = {}) => {
      const root = await createTempDir();
      for (const name of files) await writeFile(join(root, name), "video", "utf8");
      const info = createFileInfo({
        filePath: join(root, files[0]),
        fileName: files[0].replace(/\.\w+$/u, ""),
        ...fileInfo,
      });
      const plan = organizer.plan(info, createCrawlerData({ number: info.number }), config, target);
      return { root, layout: organizer.resolveOutputPlan(plan, info.filePath) };
    };

    const single = await resolveInPlace(["source.mp4", "trailer.mp4"], { number: "XYZ-999" });
    await expect(single.layout).resolves.toMatchObject({
      targetVideoPath: join(single.root, "source.mp4"),
      nfoPath: join(single.root, "source.nfo"),
    });
    const multipart = await resolveInPlace(["FC2-123456-1.mp4", "FC2-123456-2.mp4", "FC2-123456-花絮.mp4"], {
      number: "FC2-123456",
      part: { number: 1, suffix: "-1" },
    });
    await expect(multipart.layout).resolves.toMatchObject({
      targetVideoPath: join(multipart.root, "FC2-123456-1.mp4"),
      nfoPath: join(multipart.root, "FC2-123456.nfo"),
    });
    await expect((await resolveInPlace(["source.mp4", "another.mkv"], { number: "XYZ-999" })).layout).rejects.toThrow(
      "Source directory contains multiple movies; scrape it into a library that writes metadata to its own folder",
    );
  });

  it("allows multipart videos to reuse an existing shared base NFO without hanging", async () => {
    const root = await createTempDir();
    const organizer = new FileOrganizer();
    const fileInfo = createFileInfo({
      filePath: join(root, "FC2-123456-cd2.mp4"),
      fileName: "FC2-123456-cd2",
      number: "FC2-123456",
      part: { number: 2, suffix: "-cd2" },
    });
    const plan = organizer.plan(
      fileInfo,
      createCrawlerData({ number: "FC2-123456" }),
      ...movedInto(join(root, "output")),
    );

    await writeFile(fileInfo.filePath, "video", "utf8");
    await mkdir(plan.outputDir, { recursive: true });
    await writeFile(join(plan.outputDir, "FC2-123456.nfo"), "<movie />", "utf8");

    await expect(organizer.resolveOutputPlan(plan, fileInfo.filePath)).resolves.toMatchObject({
      targetVideoPath: join(root, "output", "FC2-123456", "FC2-123456-cd2.mp4"),
      nfoPath: join(root, "output", "FC2-123456", "FC2-123456.nfo"),
    });
  });
});
