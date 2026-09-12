import * as fs from "node:fs/promises";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LibraryRepository, PublicationJournalRepository } from "@mdcz/persistence";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeLibraryRows } from "../../../persistence/src/libraryWrite";
import { mediaRoots } from "../../../persistence/src/schema";
import { createTestPersistenceDatabase } from "../../../persistence/src/testDatabase";
import { findSubtitleSidecars } from "../scrape/media";
import { NfoGenerator } from "../scrape/nfo";
import { PublicationConflictError } from "./conflicts";
import { createPublicationPlan } from "./createPublicationPlan";
import { adaptPublicationJournal } from "./journalAdapter";
import { libraryEntryFromPublicationPlan } from "./libraryEntry";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { preparePublicationPlan } from "./preparePublicationPlan";
import { commitPublishedMedia } from "./publishMedia";
import { recoverPublications } from "./recoverPublications";
import { registeredMediaLocations, registeredOutputPaths } from "./registeredOutputs";
import type { PublishMediaOptions } from "./types";

vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const databases: ReturnType<typeof createTestPersistenceDatabase>[] = [];
const directories: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-prepared-publication-"));
  directories.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  const staging = join(root, "staging");
  await Promise.all([mkdir(source), mkdir(output), mkdir(staging)]);
  const database = createTestPersistenceDatabase();
  databases.push(database);
  database.db
    .insert(mediaRoots)
    .values({ id: "root", displayName: "root", hostPath: root, createdAt: new Date(), updatedAt: new Date() })
    .run();
  const outputs = new LibraryRepository(database);
  return {
    root,
    source,
    output,
    staging,
    outputs,
    database,
    journal: adaptPublicationJournal(new PublicationJournalRepository(database)),
  };
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("preparePublicationPlan", () => {
  it.each([
    { unavailable: "unrelated", code: "ENOTCONN", succeeds: true },
    { unavailable: "unrelated", code: "EACCES", succeeds: true },
    { unavailable: "output", code: "ENOTCONN", succeeds: false },
    { unavailable: "nested", code: "ENOTCONN", succeeds: true },
  ])("isolates unavailable roots without ignoring required paths: $unavailable/$code", async ({
    unavailable,
    code,
    succeeds,
  }) => {
    const { root, source, output, outputs, journal, database } = await fixture();
    const offline = join(root, "offline");
    await mkdir(offline);
    database.db
      .insert(mediaRoots)
      .values({
        id: "offline",
        hostPath: offline,
        displayName: "offline",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    await outputs.upsertEntry({ id: "unrelated", rootId: "offline", rootRelativePath: "other.mp4" });
    const video = join(source, "ABC-123.mp4");
    await writeFile(video, "video");
    await outputs.upsertEntry({ id: "media", rootId: "root", rootRelativePath: "source/ABC-123.mp4" });
    const prepared = await preparePublicationPlan({
      sourceVideoPath: video,
      outputVideoPath: video,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "movie",
      organizePlan: {
        outputDir: source,
        metadataDir: output,
        metadataRoot: output,
        targetVideoPath: video,
        nfoPath: join(output, "movie.nfo"),
        strmPath: join(output, "ABC-123.strm"),
      },
      writeNfo: async () => undefined,
    });
    const original = fs.realpath;
    const failedPath =
      unavailable === "output" ? output : unavailable === "nested" ? join(offline, "other.mp4") : offline;
    vi.spyOn(fs, "realpath").mockImplementation(async (path, options) => {
      if (String(path) === failedPath) throw Object.assign(new Error(`${code}: offline fixture`), { code });
      return await original(path, options as never);
    });
    const roots = [
      { id: "root", hostPath: root },
      { id: "offline", hostPath: offline },
    ];
    const publish = commitPublishedMedia(createPublicationPlan("offline", "scrape", prepared.plan, roots), {
      outputs,
      journal,
      resolveRoot: async (id) => {
        const found = roots.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`Missing test root: ${id}`);
        return found;
      },
      commit: () => undefined,
    });
    if (succeeds) {
      await publish;
      expect(await readFile(join(output, "ABC-123.strm"), "utf8")).toBe(video);
    } else await expect(publish).rejects.toThrow("offline fixture");
    expect(await readFile(video, "utf8")).toBe("video");
  });
  it.each([
    { extension: ".mp4", conflict: true },
    { extension: ".strm", conflict: false },
  ])("protects both videos and their attachments ($extension, conflict=$conflict)", async ({ extension, conflict }) => {
    const { root, source, output, staging } = await fixture();
    const metadata = join(root, "metadata");
    await mkdir(metadata);
    const sourceVideoPath = join(source, `ABC-123${extension}`);
    const outputVideoPath = join(output, `ABC-123${extension}`);
    const nfoPath = join(metadata, "ABC-123.nfo");
    const strmPath = join(metadata, "ABC-123.strm");
    const subtitles = [".zh.srt", ".ass", ".idx", ".sub"];
    if (conflict)
      for (const suffix of [".nfo", ".strm", "-poster.jpg"])
        await writeFile(join(metadata, `ABC-123${suffix}`), `old${suffix}`);
    if (conflict)
      for (const suffix of subtitles.filter((suffix) => suffix !== ".ass"))
        await writeFile(join(output, `ABC-123${suffix}`), `old${suffix}`);
    if (conflict) await writeFile(outputVideoPath, "old video");
    const videoContent = extension === ".strm" ? "https://new.example/video.mp4" : "new video";
    await writeFile(sourceVideoPath, videoContent);
    for (const suffix of subtitles) await writeFile(join(source, `ABC-123${suffix}`), `new${suffix}`);
    await writeFile(join(staging, "ABC-123-poster.jpg"), "new poster");
    const generator = new NfoGenerator();
    const { plan: prepared } = await preparePublicationPlan({
      sourceVideoPath,
      outputVideoPath,
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: metadata,
      downloadedAssets: { downloaded: [], sceneImages: [], poster: join(staging, "ABC-123-poster.jpg") },
      actorPhotoPaths: [],
      nfoNaming: "both",
      organizePlan: {
        outputDir: output,
        targetVideoPath: outputVideoPath,
        nfoPath,
        strmPath,
        subtitleSidecars: await findSubtitleSidecars(sourceVideoPath),
      },
      writeNfo: (assets, writeFile) =>
        generator.writeNfo(
          nfoPath,
          {
            number: "ABC-123",
            title: "ABC-123-poster.jpg",
            actors: [],
            genres: [],
            scene_images: [],
            website: Website.JAVDB,
          },
          { assets, nfoNaming: "both", writeFile },
        ),
    });
    const mediaRoot = { id: "root", hostPath: root };
    const plan = createPublicationPlan("publication", "scrape", prepared, [mediaRoot]);
    const options = {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: vi.fn(),
    };
    if (conflict) {
      const video = plan.videos?.[0];
      if (!video) throw new Error("Fixture video is required");
      plan.replaceExistingTargets = [...(plan.replaceExistingTargets ?? []), video.target];
      await expect(commitPublishedMedia(plan, options)).rejects.toBeInstanceOf(PublicationConflictError);
      expect(options.commit).not.toHaveBeenCalled();
      expect(options.journal.listUnfinished()).toEqual([]);
      expect(await readFile(sourceVideoPath, "utf8")).toBe(videoContent);
      expect(await readFile(outputVideoPath, "utf8")).toBe("old video");
      for (const suffix of [".nfo", ".strm", "-poster.jpg"])
        expect(await readFile(join(metadata, `ABC-123${suffix}`), "utf8")).toBe(`old${suffix}`);
      for (const suffix of subtitles) {
        expect(await readFile(join(source, `ABC-123${suffix}`), "utf8")).toBe(`new${suffix}`);
        if (suffix === ".ass")
          await expect(readFile(join(output, `ABC-123${suffix}`))).rejects.toMatchObject({ code: "ENOENT" });
        else expect(await readFile(join(output, `ABC-123${suffix}`), "utf8")).toBe(`old${suffix}`);
      }
      return;
    }
    await commitPublishedMedia(plan, options);
    expect(options.commit).toHaveBeenCalledOnce();
    expect((await readFile(outputVideoPath, "utf8")).trim()).toBe(videoContent);
    for (const suffix of subtitles)
      expect(await readFile(join(output, `ABC-123${suffix}`), "utf8")).toBe(`new${suffix}`);
    expect((await readFile(strmPath, "utf8")).trim()).toBe(extension === ".strm" ? videoContent : outputVideoPath);
    const nfo = await readFile(nfoPath, "utf8");
    expect(nfo).toContain('<thumb aspect="poster">ABC-123-poster.jpg</thumb>');
    expect(nfo).toContain("<title>ABC-123-poster.jpg</title>");
  });
  it.each([
    false,
    true,
  ])("copies existing metadata without deleting it when moving media (shared=%s)", async (shared) => {
    const { root, source, output, staging } = await fixture();
    await mkdir(join(source, ".actors"));
    await mkdir(join(source, "extrafanart"));
    const files = ["movie.mp4", "movie.nfo", "poster.jpg", "trailer.mp4", ".actors/Actor.jpg", "extrafanart/scene.jpg"];
    for (const name of files) await writeFile(join(source, name), name);
    if (shared) await writeFile(join(source, "another.mp4"), "another video");
    const publication = await preparePublicationPlan({
      sourceVideoPath: join(source, "movie.mp4"),
      outputVideoPath: join(output, "movie.mp4"),
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      existingAssets: {
        poster: join(source, "poster.jpg"),
        trailer: join(source, "trailer.mp4"),
        actorPhotos: [join(source, ".actors/Actor.jpg")],
        sceneImages: [join(source, "extrafanart/scene.jpg")],
      },
      existingNfoPath: join(source, "movie.nfo"),
      organizePlan: {
        outputDir: output,
        targetVideoPath: join(output, "movie.mp4"),
        nfoPath: join(output, "movie.nfo"),
      },
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    expect(publication.nfoPath).toBe(join(output, "movie.nfo"));
    expect(publication.assets.actorPhotos).toEqual([join(output, ".actors/Actor.jpg")]);
    expect(publication.plan.sidecars?.some((move) => move.sourcePath === join(source, "trailer.mp4"))).toBe(true);
    const mediaRoot = { id: "root", hostPath: root };
    await commitPublishedMedia(createPublicationPlan("test", "maintenance", publication.plan, [mediaRoot]), {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: () => undefined,
    });
    for (const name of files) {
      expect(await readFile(join(output, name), "utf8")).toBe(name);
      if (name !== "movie.mp4") expect(await readFile(join(source, name), "utf8")).toBe(name);
      else await expect(readFile(join(source, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it.each([
    "filename",
    "both",
  ] as const)("reconciles preserved NFOs using %s naming only after commit", async (nfoNaming) => {
    const { root, source, output } = await fixture();
    const sourceVideoPath = join(source, "ABC-123.mp4");
    const outputVideoPath = join(output, "ABC-123.mp4");
    const original = "<movie><title>Original</title></movie>";
    await writeFile(sourceVideoPath, "video");
    for (const name of ["ABC-123.nfo", "movie.nfo"]) {
      await writeFile(join(source, name), original);
      await writeFile(join(output, name), "stale");
    }
    const publication = await preparePublicationPlan({
      sourceVideoPath,
      outputVideoPath,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      existingNfoPath: join(source, "ABC-123.nfo"),
      nfoNaming,
      organizePlan: { outputDir: output, targetVideoPath: outputVideoPath, nfoPath: join(output, "ABC-123.nfo") },
      writeNfo: async () => undefined,
    });
    expect(await readFile(join(source, "ABC-123.nfo"), "utf8")).toBe(original);
    const mediaRoot = { id: "root", hostPath: root };
    await commitPublishedMedia(createPublicationPlan("nfo", "maintenance", publication.plan, [mediaRoot]), {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: () => undefined,
    });
    for (const name of ["ABC-123.nfo", "movie.nfo"]) {
      const retained = nfoNaming === "both" || name === "ABC-123.nfo";
      if (retained) expect(await readFile(join(output, name), "utf8")).toBe(original);
      else expect(await readFile(join(output, name), "utf8")).toBe("stale");
      expect(await readFile(join(source, name), "utf8")).toBe(original);
    }
  });

  describe("independent output ownership", () => {
    let context: Awaited<ReturnType<typeof fixture>>;
    let sourceVideoPath: string;
    let options: PublishMediaOptions<void>;
    const originals = {
      "ABC-123.mp4": "video",
      "ABC-123.zh.forced.srt": "subtitle",
      "movie.nfo": "source NFO",
      "poster.jpg": "source poster",
      "DEF-456.zh.srt": "unmatched subtitle",
    };

    beforeEach(async () => {
      context = await fixture();
      const { root, source, staging, outputs, journal } = context;
      sourceVideoPath = join(source, "ABC-123.mp4");
      await outputs.upsertEntry({ id: "media", rootId: "root", rootRelativePath: "source/ABC-123.mp4" });
      for (const [name, content] of Object.entries(originals)) await writeFile(join(source, name), content);
      await writeFile(join(staging, "poster.jpg"), "poster v1");
      options = {
        resolveRoot: async () => ({ id: "root", hostPath: root }),
        journal,
        outputs,
        commit: () => undefined,
      };
    });

    afterEach(async () => {
      expect((await readdir(context.source)).sort()).toEqual(Object.keys(originals).sort());
      for (const [name, content] of Object.entries(originals))
        expect(await readFile(join(context.source, name), "utf8")).toBe(content);
    });

    const prepare = async (id = "independent", destination = context.output, metadataOutputDir = destination) => {
      const { root, source, staging } = context;
      const { plan } = await preparePublicationPlan({
        sourceVideoPath,
        outputVideoPath: sourceVideoPath,
        stagingDir: staging,
        existingAssetDir: source,
        metadataOutputDir,
        downloadedAssets: { downloaded: [], sceneImages: [], poster: join(staging, "poster.jpg") },
        actorPhotoPaths: [],
        existingAssets: { sceneImages: [], actorPhotos: [], poster: join(source, "poster.jpg") },
        organizePlan: {
          outputDir: source,
          metadataDir: destination,
          metadataRoot: destination,
          targetVideoPath: sourceVideoPath,
          nfoPath: join(destination, "movie.nfo"),
          strmPath: join(destination, "ABC-123.strm"),
          subtitleSidecars: await findSubtitleSidecars(sourceVideoPath),
        },
        nfoNaming: "movie",
        writeNfo: async (_, write) => {
          await write(join(destination, "movie.nfo"), "<movie>new</movie>");
          return join(destination, "movie.nfo");
        },
      });
      expect(plan.videos).toEqual([]);
      expect(plan.media?.[0]?.targetPath).toBe(sourceVideoPath);
      expect(plan.obsoletePaths).not.toContain(join(source, "ABC-123.zh.forced.srt"));
      return createPublicationPlan(id, "scrape", plan, [{ id: "root", hostPath: root }]);
    };

    const assertOutputs = async () => {
      expect(await readFile(join(context.output, "ABC-123.strm"), "utf8")).toBe(resolve(sourceVideoPath));
      expect(await readFile(join(context.output, "ABC-123.zh.forced.srt"), "utf8")).toBe("subtitle");
      expect(await readdir(context.output)).not.toContain("DEF-456.zh.srt");
    };

    it.each(["junction", "overlap"])("rejects a source/output boundary violation: %s", async (scenario) => {
      const { source, output } = context;
      if (scenario === "junction") {
        await rm(output, { recursive: true });
        await symlink(source, output, "junction");
      }
      await expect(prepare("boundary", output, scenario === "overlap" ? source : output)).rejects.toThrow(
        /protected|root|relative/i,
      );
    });

    it.each([
      "unknown-output",
      "other-owner",
      "discovered-output",
      "tampered-plan",
    ])("rejects undeclared or unowned mutations: %s", async (scenario) => {
      const { output, outputs } = context;
      if (scenario !== "tampered-plan") await writeFile(join(output, "movie.nfo"), "unowned NFO");
      if (scenario === "other-owner" || scenario === "discovered-output")
        await outputs.upsertEntry({
          id: scenario === "discovered-output" ? "media" : "previous",
          rootId: "root",
          rootRelativePath: scenario === "discovered-output" ? "source/ABC-123.mp4" : "source/previous.mp4",
          assets: [
            {
              kind: "nfo",
              uri: "output/movie.nfo",
              rootId: "root",
              relativePath: "output/movie.nfo",
              published: scenario === "other-owner",
            },
          ],
        });
      const plan = await prepare();
      if (scenario === "tampered-plan") plan.obsolete.push({ rootId: "root", relativePath: "source/ABC-123.mp4" });
      await expect(commitPublishedMedia(plan, options)).rejects.toThrow(/未登记|declared|protected/);
    });

    it.each([
      "commit",
      "registration",
      "stage-journal",
    ])("rolls back failed publication transactions: %s", async (stage) => {
      const { output, outputs, journal } = context;
      const fail = () => {
        throw new Error(`${stage} failure`);
      };
      if (stage === "commit") options.commit = fail;
      else if (stage === "registration") {
        const register = outputs.registerPublishedOutputs.bind(outputs);
        vi.spyOn(outputs, "registerPublishedOutputs").mockImplementationOnce((refs) => {
          register(refs);
          fail();
        });
      } else vi.spyOn(journal, "stage").mockImplementationOnce(fail);
      await expect(commitPublishedMedia(await prepare(), options)).rejects.toThrow(`${stage} failure`);
      expect((await outputs.getEntryById("media")).assets).toEqual([]);
      expect(await readdir(output)).toEqual([]);
      expect(journal.listUnfinished()).toEqual([]);
    });

    it("recovers interrupted cleanup using persisted source protection", async () => {
      await expect(
        commitPublishedMedia(await prepare(), {
          ...options,
          fileSystem: {
            ...fs,
            rm: async (path, opts) => {
              if (path.endsWith(".part")) throw new Error("interrupted cleanup");
              await fs.rm(path, opts);
            },
          },
        }),
      ).rejects.toThrow("cleanup failed");
      const manifest = context.journal.listUnfinished()[0]?.manifest;
      expect(manifest?.boundary?.readOnlyDirectories[0]?.path).toBe(context.source);
      expect(manifest?.entries.every((entry) => !entry.source)).toBe(true);
      expect(manifest?.obsolete).toEqual([]);
      await recoverPublications(options);
      expect(context.journal.listUnfinished()).toEqual([]);
      await assertOutputs();
    });

    it.each(["success", "hardlink", "record-removed"])("updates only owned outputs on rerun: %s", async (scenario) => {
      const { source, output, staging, outputs } = context;
      await commitPublishedMedia(await prepare(), options);
      if (scenario === "hardlink") {
        await rm(join(output, "poster.jpg"));
        await link(join(source, "poster.jpg"), join(output, "poster.jpg"));
      }
      await writeFile(join(staging, "poster.jpg"), "poster v2");
      const plan = await prepare("rerun");
      if (scenario === "record-removed") {
        outputs.deleteEntry("media");
        await outputs.upsertEntry({ id: "replacement", rootId: "root", rootRelativePath: "source/ABC-123.mp4" });
        await expect(commitPublishedMedia(plan, options)).rejects.toBeInstanceOf(PublicationConflictError);
      } else await commitPublishedMedia(plan, options);
      expect(await readFile(join(output, "poster.jpg"), "utf8")).toBe(
        scenario === "record-removed" ? "poster v1" : "poster v2",
      );
      await assertOutputs();
    });

    it("releases references to missing outputs when assigning a new owner", async () => {
      await context.outputs.upsertEntry({
        id: "previous",
        rootId: "root",
        rootRelativePath: "source/previous.mp4",
        assets: [
          { kind: "nfo", uri: "output/movie.nfo", rootId: "root", relativePath: "output/movie.nfo", published: true },
        ],
      });
      await commitPublishedMedia(await prepare(), options);
      expect((await context.outputs.getEntryById("previous")).assets).toEqual([]);
      await assertOutputs();
    });

    it("retains old files for manual cleanup and only remembers historical STRMs after relocation", async () => {
      const { root, output, outputs, database } = context;
      const strmPath = join(output, "ABC-123.strm");
      await commitPublishedMedia(await prepare(), options);
      const nextOutput = join(root, "next-output");
      const relocated = await prepare("relocated", nextOutput);
      const commit = (publication: typeof relocated) => {
        const target = publication.media?.[0]?.target;
        if (!target) throw new Error("Missing test media");
        return writeLibraryRows(database, {
          id: "media",
          ...libraryEntryFromPublicationPlan(publication, { number: "ABC-123", title: "movie", actors: [] }, target),
        });
      };
      await expect(
        commitPublishedMedia(relocated, {
          ...options,
          commit: () => {
            commit(relocated);
            throw new Error("relocation failed");
          },
        }),
      ).rejects.toThrow("relocation failed");
      expect(
        (await registeredMediaLocations(outputs, options.resolveRoot, [sourceVideoPath])).get(sourceVideoPath)
          ?.strmPath,
      ).toBe(strmPath);
      await commitPublishedMedia(relocated, { ...options, commit: () => commit(relocated) });
      expect(await readFile(strmPath, "utf8")).toBe(sourceVideoPath);
      const locations = await registeredMediaLocations(outputs, options.resolveRoot, [sourceVideoPath]);
      expect(locations.get(sourceVideoPath)).toMatchObject({
        nfoPath: join(nextOutput, "movie.nfo"),
        strmPath: join(nextOutput, "ABC-123.strm"),
      });
      expect(
        (await outputs.getEntryById("media")).assets.every((asset) => asset.relativePath?.startsWith("next-output/")),
      ).toBe(true);
      expect((await registeredOutputPaths(outputs, options.resolveRoot, "strm")).size).toBe(2);
      expect(locations.get(sourceVideoPath)?.generatedStrmPaths).toHaveLength(1);
      const returned = await prepare("return");
      await expect(
        commitPublishedMedia(returned, { ...options, commit: () => commit(returned) }),
      ).rejects.toBeInstanceOf(PublicationConflictError);
      await assertOutputs();
      for (const name of await readdir(output)) await rm(join(output, name));
      await commitPublishedMedia(await prepare("return-after-cleanup"), { ...options, commit: () => commit(returned) });
      await assertOutputs();
    });
  });

  it.each([
    { names: ["ABC-123-CD1", "ABC-123-CD2"], conflict: false },
    { names: ["ABC-123-1080p", "ABC-123-4k"], conflict: true },
    { names: ["ABC-123", "DEF-456"], conflict: true },
  ])("shares outputs only with explicitly participating media: $names", async ({ names, conflict }) => {
    const { root, source, output, outputs } = await fixture();
    const mediaRoot = { id: "root", hostPath: root };
    const journal = createMemoryPublicationJournal();
    for (const [index, name] of names.entries()) {
      const sourcePath = join(source, `${name}.mp4`);
      await writeFile(sourcePath, name);
      await outputs.upsertEntry({ id: name, rootId: "root", rootRelativePath: `source/${name}.mp4` });
      const publish = async () => {
        const nfoPath = join(output, "movie.nfo");
        const { plan } = await preparePublicationPlan({
          sourceVideoPath: sourcePath,
          outputVideoPath: sourcePath,
          existingAssetDir: output,
          metadataOutputDir: output,
          downloadedAssets: { downloaded: [], sceneImages: [] },
          actorPhotoPaths: [],
          nfoNaming: "movie",
          organizePlan: {
            outputDir: source,
            metadataDir: output,
            targetVideoPath: sourcePath,
            nfoPath,
            strmPath: join(output, `${name}.strm`),
          },
          writeNfo: async (_, write) => {
            await write(nfoPath, name);
            return nfoPath;
          },
        });
        if (index && !conflict)
          plan.media?.push({
            sourcePath: join(source, `${names[0]}.mp4`),
            targetPath: join(source, `${names[0]}.mp4`),
            size: names[0].length,
            assets: [{ kind: "nfo", targetPath: nfoPath }],
          });
        await commitPublishedMedia(createPublicationPlan(name, "scrape", plan, [mediaRoot]), {
          journal,
          outputs,
          resolveRoot: async () => mediaRoot,
          commit: () => undefined,
        });
      };
      if (index && conflict) await expect(publish()).rejects.toThrow("其他媒体引用");
      else await publish();
      expect(await readFile(sourcePath, "utf8")).toBe(name);
    }
    expect(await readFile(join(output, "movie.nfo"), "utf8")).toBe(conflict ? names[0] : names[1]);
    if (!conflict) {
      outputs.deleteEntry(names[0]);
      expect((await outputs.getEntryById(names[1])).assets).toContainEqual(
        expect.objectContaining({ kind: "nfo", published: true }),
      );
      expect(await readFile(join(output, "movie.nfo"), "utf8")).toBe(names[1]);
    }
  });

  it("publishes distinct outputs concurrently without a directory manifest", async () => {
    const { root, source, output } = await fixture();
    const mediaRoot = { id: "root", hostPath: root };
    const journal = createMemoryPublicationJournal();
    const plans = await Promise.all(
      ["ABC-123", "DEF-456"].map(async (name) => {
        const sourcePath = join(source, `${name}.mp4`);
        await writeFile(sourcePath, name);
        const { plan } = await preparePublicationPlan({
          sourceVideoPath: sourcePath,
          outputVideoPath: sourcePath,
          existingAssetDir: output,
          metadataOutputDir: output,
          downloadedAssets: { downloaded: [], sceneImages: [] },
          actorPhotoPaths: [],
          nfoNaming: "filename",
          organizePlan: {
            outputDir: source,
            metadataDir: output,
            targetVideoPath: sourcePath,
            nfoPath: join(output, `${name}.nfo`),
            strmPath: join(output, `${name}.strm`),
          },
          writeNfo: async () => undefined,
        });
        return createPublicationPlan(name, "scrape", plan, [mediaRoot]);
      }),
    );
    const results = await Promise.allSettled(
      plans.map((plan) =>
        commitPublishedMedia(plan, { journal, resolveRoot: async () => mediaRoot, commit: () => undefined }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(0);
    expect((await readdir(source)).sort()).toEqual(["ABC-123.mp4", "DEF-456.mp4"]);
  });

  it.each([
    "https://media.example/movie.mp4",
    "/media/movie.mp4",
    "../media/movie.mp4",
  ])("mirrors STRM target %s without introducing an extra STRM hop", async (target) => {
    const { root, source, output, staging } = await fixture();
    const original = `\uFEFF#KODIPROP:inputstream=inputstream.adaptive\r\n${target}\r\n`;
    await writeFile(join(source, "movie.strm"), original);
    const publication = await preparePublicationPlan({
      sourceVideoPath: join(source, "movie.strm"),
      outputVideoPath: join(output, "movie.strm"),
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      organizePlan: {
        outputDir: output,
        targetVideoPath: join(output, "movie.strm"),
        nfoPath: join(output, "movie.nfo"),
        strmPath: join(output, "mirror.strm"),
      },
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    const artifact = publication.plan.artifacts.find((artifact) => artifact.targetPath === join(output, "mirror.strm"));
    expect(artifact?.content.kind === "text" ? artifact.content.data : undefined).toBe(
      target.startsWith("..") ? original.replace(target, join(root, "media/movie.mp4")) : original,
    );
    expect(await readFile(join(source, "movie.strm"), "utf8")).toBe(original);
  });
});
