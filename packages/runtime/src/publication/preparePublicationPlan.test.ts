import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPublicationLayout } from "../scrape/FileOrganizer";
import { resolvePublicationAssetLayout } from "./assetLayout";
import { preparePublicationPlan, retainedRegisteredFeatures } from "./preparePublicationPlan";
import type { PublicationParticipants } from "./types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-publication-plan-"));
  directories.push(root);
  const sourceDir = join(root, "source");
  const outputDir = join(root, "output");
  await Promise.all([mkdir(sourceDir), mkdir(outputDir)]);
  const sourceVideoPath = join(sourceDir, "ABC-123.mp4");
  await writeFile(sourceVideoPath, "video");
  const roots = [{ id: "root", hostPath: root }];
  const fileId = randomUUID();
  const identity: PublicationParticipants = {
    movieId: randomUUID(),
    members: [{ fileId, source: { rootId: "root", relativePath: "source/ABC-123.mp4" } }],
    expected: { files: [], assets: [] },
  };
  return { root, roots, sourceDir, outputDir, sourceVideoPath, fileId, identity };
};

const layout = (
  sourceVideoPath: string,
  outputDir: string,
  overrides: Partial<ResolvedPublicationLayout> = {},
): ResolvedPublicationLayout => ({
  mode: "move",
  sourceVideoPath,
  targetVideoPath: join(outputDir, "ABC-123.mp4"),
  outputDir,
  metadataDir: outputDir,
  existingMetadataDir: dirname(sourceVideoPath),
  nfoPath: join(outputDir, "ABC-123.nfo"),
  sidecars: [],
  ...overrides,
});

describe("preparePublicationPlan", () => {
  it("builds a final rooted plan from resolved media and sidecar destinations", async () => {
    const context = await fixture();
    const subtitle = join(context.sourceDir, "ABC-123.zh.srt");
    const feature = join(context.sourceDir, "ABC-123-feature.mp4");
    await Promise.all([writeFile(subtitle, "subtitle"), writeFile(feature, "feature")]);
    const prepared = await preparePublicationPlan({
      operationId: "scrape-1",
      operationType: "scrape",
      roots: context.roots,
      identity: {
        ...context.identity,
        members: [
          {
            source: context.identity.members[0].source,
            fileId: context.fileId,
            assetLayout: { staged: new Map(), retained: new Map() },
            layout: layout(context.sourceVideoPath, context.outputDir, {
              sidecars: [
                {
                  kind: "subtitle",
                  sourcePath: subtitle,
                  targetPath: join(context.outputDir, "ABC-123.zh.srt"),
                },
                {
                  kind: "feature",
                  sourcePath: feature,
                  targetPath: join(context.outputDir, "ABC-123-feature.mp4"),
                },
              ],
            }),
          },
        ],
      },
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "filename",
      writeNfo: async (_assets, write) => {
        const nfo = join(context.outputDir, "ABC-123.nfo");
        await write(nfo, "<movie />");
        return nfo;
      },
    });

    expect(prepared.plan?.movieId).toBe(context.identity.movieId);
    expect(prepared.plan?.files).toEqual([
      expect.objectContaining({
        fileId: context.fileId,
        source: { rootId: "root", relativePath: "source/ABC-123.mp4" },
        target: { rootId: "root", relativePath: "output/ABC-123.mp4" },
      }),
    ]);
    expect(prepared.plan?.files[0]?.operations.map((operation) => operation.kind)).toEqual(["move", "move"]);
    expect(prepared.plan?.operations.map((operation) => operation.kind)).toEqual(["move", "write"]);
    expect(prepared.plan?.movieAssets.map((asset) => asset.kind)).toEqual(expect.arrayContaining(["feature", "nfo"]));
  });

  it("preserves media while writing an explicit mirror and mirror subtitle", async () => {
    const context = await fixture();
    const subtitle = join(context.sourceDir, "ABC-123.srt");
    await writeFile(subtitle, "subtitle");
    const mirror = join(context.outputDir, "ABC-123.strm");
    const prepared = await preparePublicationPlan({
      operationId: "mirror-1",
      operationType: "scrape",
      roots: context.roots,
      identity: {
        ...context.identity,
        members: [
          {
            source: context.identity.members[0].source,
            fileId: context.fileId,
            assetLayout: { staged: new Map(), retained: new Map() },
            layout: layout(context.sourceVideoPath, context.outputDir, {
              mode: "preserve",
              targetVideoPath: context.sourceVideoPath,
              mirror: { targetPath: mirror, content: context.sourceVideoPath },
              sidecars: [
                {
                  kind: "subtitle",
                  sourcePath: subtitle,
                  targetPath: subtitle,
                  mirrorPath: join(context.outputDir, "ABC-123.srt"),
                },
              ],
            }),
          },
        ],
      },
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "filename",
      writeNfo: async () => undefined,
    });

    expect(prepared.plan?.files[0]?.source).toEqual(prepared.plan?.files[0]?.target);
    expect(prepared.plan?.files[0]?.operations.map((operation) => operation.kind)).toEqual(["write", "copy"]);
    expect(prepared.plan?.files[0]?.assets.map((asset) => asset.kind)).toEqual(["strm", "subtitle"]);
  });

  it("rejects the whole group when a required member cannot be prepared", async () => {
    const context = await fixture();
    const extraVideo = join(context.sourceDir, "ABC-123-CD2.mp4");
    const feature = join(context.sourceDir, "ABC-123-feature.mp4");
    const extraId = randomUUID();
    await Promise.all([writeFile(extraVideo, "video-2"), writeFile(feature, "feature")]);
    const prepared = preparePublicationPlan({
      operationId: "whole-group",
      operationType: "scrape",
      roots: context.roots,
      identity: {
        movieId: context.identity.movieId,
        expected: { files: [], assets: [] },
        members: [
          {
            source: context.identity.members[0].source,
            fileId: context.fileId,
            assetLayout: { staged: new Map(), retained: new Map() },
            layout: layout(context.sourceVideoPath, context.outputDir),
          },
          {
            source: { rootId: "root", relativePath: "source/ABC-123-CD2.mp4" },
            fileId: extraId,
            assetLayout: { staged: new Map(), retained: new Map() },
            layout: layout(extraVideo, context.outputDir, {
              targetVideoPath: join(context.outputDir, "ABC-123-CD2.mp4"),
              nfoPath: join(context.outputDir, "ABC-123-CD2.nfo"),
              sidecars: [
                {
                  kind: "feature",
                  sourcePath: feature,
                  targetPath: join(context.outputDir, "ABC-123-feature.mp4"),
                },
                {
                  kind: "subtitle",
                  sourcePath: join(context.sourceDir, "missing.srt"),
                  targetPath: join(context.outputDir, "missing.srt"),
                },
              ],
            }),
          },
        ],
      },
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "filename",
      writeNfo: async () => undefined,
    });
    await expect(prepared).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    {
      mode: "move" as const,
      targetDir: "output" as const,
      expectedPosterRef: "poster.png",
      expectedSceneRef: "extrafanart/fanart1.jpg",
      expectedActorRef: ".actors/Actor.jpg",
      expectedCopies: 4,
    },
    {
      mode: "preserve" as const,
      targetDir: "output" as const,
      expectedPosterRef: "../source/old-poster.png",
      expectedSceneRef: "../source/extrafanart/fanart1.jpg",
      expectedActorRef: "../source/.actors/Actor.jpg",
      expectedCopies: 0,
    },
    {
      mode: "preserve" as const,
      targetDir: "source" as const,
      expectedPosterRef: "old-poster.png",
      expectedSceneRef: "extrafanart/fanart1.jpg",
      expectedActorRef: ".actors/Actor.jpg",
      expectedCopies: 0,
    },
  ])("retains metadata, rewrites NFO references according to relative layout ($mode to $targetDir)", async ({
    mode,
    targetDir,
    expectedPosterRef,
    expectedSceneRef,
    expectedActorRef,
    expectedCopies,
  }) => {
    const context = await fixture();
    const poster = join(context.sourceDir, "old-poster.png");
    const scene1 = join(context.sourceDir, "extrafanart", "fanart1.jpg");
    const scene2 = join(context.sourceDir, "extrafanart", "fanart2.jpg");
    const actor = join(context.sourceDir, ".actors", "Actor.jpg");
    const existingNfoPath = join(context.sourceDir, "ABC-123.nfo");
    await Promise.all([mkdir(join(context.sourceDir, "extrafanart")), mkdir(join(context.sourceDir, ".actors"))]);
    await Promise.all([
      writeFile(poster, "poster"),
      writeFile(scene1, "scene1"),
      writeFile(scene2, "scene2"),
      writeFile(actor, "actor"),
      writeFile(
        existingNfoPath,
        "<movie><title>Retained title</title><poster>old-poster.png</poster><fanart><thumb>extrafanart/fanart1.jpg</thumb></fanart><actor><thumb>.actors/Actor.jpg</thumb></actor><thumb>https://example.test/remote.jpg</thumb></movie>",
      ),
    ]);
    const targetMetaDir = targetDir === "output" ? context.outputDir : context.sourceDir;
    const resolved = layout(context.sourceVideoPath, targetMetaDir, {
      mode,
      existingMetadataDir: context.sourceDir,
      targetVideoPath: mode === "move" ? join(targetMetaDir, "ABC-123.mp4") : context.sourceVideoPath,
    });
    const config = {
      ...defaultConfiguration,
      download: { ...defaultConfiguration.download, downloadTrailer: false },
      aggregation: {
        ...defaultConfiguration.aggregation,
        behavior: { ...defaultConfiguration.aggregation.behavior, maxSceneImages: 1 },
      },
    };
    const existingAssets = { poster, sceneImages: [scene1, scene2], actorPhotos: [actor] };
    const assetLayout = await resolvePublicationAssetLayout({
      layout: resolved,
      config,
      existingAssets,
    });
    expect(assetLayout.staged.has("trailer.mp4")).toBe(false);
    expect(assetLayout.retained.has(scene2)).toBe(true);
    const members = [
      { ...context.identity.members[0], layout: resolved, assetLayout, existingAssets, existingNfoPath },
    ];
    const prepared = await preparePublicationPlan({
      operationId: "retained-metadata",
      operationType: "maintenance",
      roots: context.roots,
      identity: {
        ...context.identity,
        members,
      },
      retainedMovieAssets: retainedRegisteredFeatures(members, [
        {
          rootId: "root",
          relativePath: "output/ABC-123-feature.mp4",
          itemId: context.identity.movieId,
          fileId: null,
          kind: "feature",
          published: true,
          historical: false,
        },
      ]),
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "both",
      writeNfo: async () => undefined,
    });
    expect(prepared.assets.poster).toBe(mode === "move" ? join(targetMetaDir, "poster.png") : poster);
    expect(prepared.assets.sceneImages).toEqual(
      mode === "move"
        ? [join(targetMetaDir, "extrafanart", "fanart1.jpg"), join(targetMetaDir, "extrafanart", "fanart2.jpg")]
        : [scene1, scene2],
    );
    expect(prepared.assets.actorPhotos).toEqual([
      mode === "move" ? join(targetMetaDir, ".actors", "Actor.jpg") : actor,
    ]);
    expect(prepared.plan?.operations.filter((operation) => operation.kind === "copy")).toHaveLength(expectedCopies);
    const writes = prepared.plan?.operations.filter((operation) => operation.kind === "write") ?? [];
    expect(writes.map((operation) => operation.target.relativePath)).toEqual([
      `${targetDir}/ABC-123.nfo`,
      `${targetDir}/movie.nfo`,
    ]);
    for (const write of writes) {
      expect(write.content).toEqual({ kind: "text", data: expect.stringContaining("Retained title") });
      expect(write.content).toEqual({
        kind: "text",
        data: expect.stringContaining(`<poster>${expectedPosterRef}</poster>`),
      });
      expect(write.content).toEqual({
        kind: "text",
        data: expect.stringContaining(`<fanart><thumb>${expectedSceneRef}</thumb></fanart>`),
      });
      expect(write.content).toEqual({
        kind: "text",
        data: expect.stringContaining(`<actor><thumb>${expectedActorRef}</thumb></actor>`),
      });
      expect(write.content).toEqual({ kind: "text", data: expect.stringContaining("https://example.test/remote.jpg") });
    }
    expect(resolve(targetMetaDir, expectedPosterRef)).toBe(prepared.assets.poster);
    expect(resolve(targetMetaDir, expectedSceneRef)).toBe(prepared.assets.sceneImages[0]);
    expect(resolve(targetMetaDir, expectedActorRef)).toBe(prepared.assets.actorPhotos[0]);
    expect(prepared.plan?.files[0]?.source).toEqual(context.identity.members[0].source);
    expect(prepared.plan?.movieAssets).toContainEqual({
      type: "local",
      kind: "feature",
      file: { rootId: "root", relativePath: "output/ABC-123-feature.mp4" },
    });
  });

  it("records rewritten STRM byte length instead of the source file size", async () => {
    const context = await fixture();
    const sourceVideoPath = join(context.sourceDir, "ABC-123.strm");
    await writeFile(sourceVideoPath, "video.mp4");
    const mediaContent = "much-longer-rewritten-relative-target-path.mp4";
    const prepared = await preparePublicationPlan({
      operationId: "strm-size",
      operationType: "scrape",
      roots: context.roots,
      identity: {
        ...context.identity,
        members: [
          {
            source: { rootId: "root", relativePath: "source/ABC-123.strm" },
            fileId: context.fileId,
            assetLayout: { staged: new Map(), retained: new Map() },
            layout: layout(sourceVideoPath, context.outputDir, {
              targetVideoPath: join(context.outputDir, "ABC-123.strm"),
              nfoPath: join(context.outputDir, "ABC-123.nfo"),
              mediaContent,
            }),
          },
        ],
      },
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      nfoNaming: "filename",
      writeNfo: async () => undefined,
    });
    expect(prepared.plan?.files[0]?.size).toBe(Buffer.byteLength(mediaContent));
    expect(prepared.plan?.files[0]?.sourceSize).toBe(Buffer.byteLength("video.mp4"));
    expect(prepared.plan?.files[0]?.operations).toEqual([
      expect.objectContaining({ kind: "write", content: { kind: "text", data: mediaContent } }),
    ]);
  });
});
