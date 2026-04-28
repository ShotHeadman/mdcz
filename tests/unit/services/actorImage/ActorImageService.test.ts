import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService, getActorImageCacheDirectory } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import * as imageUtils from "@main/utils/image";
import { app } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-actor-image-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createUserDataDir = async (): Promise<string> => {
  const userDataDir = await createTempDir();
  vi.spyOn(app, "getPath").mockReturnValue(userDataDir);
  return userDataDir;
};

const createConfig = (root: string) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      actorPhotoFolder: root,
    },
  });

const createActorLibrary = async (): Promise<{ root: string; cacheRoot: string }> => {
  await createUserDataDir();
  const root = await createTempDir();
  const cacheRoot = getActorImageCacheDirectory();
  return { root, cacheRoot };
};

const readValidPngBytes = async (): Promise<Buffer> => readFile(join(process.cwd(), "apps/desktop/build/icon.png"));

describe("ActorImageService", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("creates cache skeleton and indexes manual root images during local resolve", async () => {
    const { root, cacheRoot } = await createActorLibrary();
    const config = createConfig(root);
    const service = new ActorImageService();
    const manualPath = join(root, "Actor A.jpg");
    await writeFile(manualPath, "manual", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor A"]);
    const index = JSON.parse(await readFile(join(cacheRoot, "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName: string }>;
    };

    expect(resolved).toBe(manualPath);
    expect(index.actors.actora).toMatchObject({
      publicFileName: "Actor A.jpg",
    });
    await expect(readFile(join(cacheRoot, "queue.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(root, ".cache", "index.json"), "utf8")).rejects.toThrow();
  });

  it("resolves relative actor photo folders under mediaPath", async () => {
    const { cacheRoot } = await createActorLibrary();
    const mediaPath = await createTempDir();
    const actorLibraryDir = join(mediaPath, "actor-library");
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath,
        actorPhotoFolder: "actor-library",
      },
    });
    const service = new ActorImageService();
    const manualPath = join(actorLibraryDir, "Actor Relative.jpg");

    await mkdir(actorLibraryDir, { recursive: true });
    await writeFile(manualPath, "manual", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor Relative"]);
    const index = JSON.parse(await readFile(join(cacheRoot, "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName: string }>;
    };

    expect(resolved).toBe(manualPath);
    expect(index.actors.actorrelative).toMatchObject({
      publicFileName: "Actor Relative.jpg",
    });
  });

  it("materializes actor images for movie NFOs and leaves missing actors empty", async () => {
    const { root } = await createActorLibrary();
    const movieDir = join(root, "Movie");
    const config = createConfig(root);
    const service = new ActorImageService();
    const manualPath = join(root, "Actor A.jpg");

    await writeFile(manualPath, "manual", "utf8");

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir,
      actors: ["Actor A", "Actor B"],
      actorProfiles: [
        { name: "Actor A", photo_url: "https://img.example.com/actor-a.jpg" },
        { name: "Actor B", photo_url: "https://img.example.com/actor-b.jpg" },
      ],
    });

    expect(profiles).toEqual([
      { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
      { name: "Actor B", photo_url: undefined },
    ]);
    expect(await readFile(join(movieDir, ".actors", "Actor A.jpg"), "utf8")).toBe("manual");
  });

  it("skips actor source lookup when a local actor image already exists", async () => {
    const { root } = await createActorLibrary();
    const movieDir = join(root, "Movie");
    const config = createConfig(root);
    const service = new ActorImageService();
    const manualPath = join(root, "Actor A.jpg");
    const actorSourceProvider = {
      lookup: vi.fn(),
    } as unknown as ActorSourceProvider;

    await writeFile(manualPath, "manual", "utf8");

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir,
      actors: ["Actor A"],
      actorSourceProvider,
    });

    expect(profiles).toEqual([{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }]);
    expect(actorSourceProvider.lookup).not.toHaveBeenCalled();
  });

  it("returns fallback on corrupt index.json without overwriting the file", async () => {
    const { root, cacheRoot } = await createActorLibrary();
    const config = createConfig(root);
    const service = new ActorImageService();

    await mkdir(cacheRoot, { recursive: true });
    await writeFile(join(cacheRoot, "index.json"), "not valid json", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor A"]);

    expect(resolved).toBeUndefined();
    expect(await readFile(join(cacheRoot, "index.json"), "utf8")).toBe("not valid json");
  });

  it("caches remote actor images into the internal cache and materializes them for movie NFOs", async () => {
    const { root, cacheRoot } = await createActorLibrary();
    const movieDir = join(root, "Movie");
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: root,
      },
    });
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const networkClient = {
      getContent: vi.fn(async () => validPngBytes),
    };
    const service = new ActorImageService({ networkClient });

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir,
      actors: ["Actor B"],
      actorProfiles: [{ name: "Actor B", photo_url: "https://img.example.com/actor-b.png" }],
    });
    const index = JSON.parse(await readFile(join(cacheRoot, "index.json"), "utf8")) as {
      actors: Record<string, { blobRelativePath?: string }>;
    };

    expect(profiles).toEqual([{ name: "Actor B", photo_url: ".actors/Actor B.png" }]);
    expect(await readFile(join(movieDir, ".actors", "Actor B.png"))).toEqual(validPngBytes);
    expect(index.actors.actorb.blobRelativePath).toBeTruthy();
    expect(await readFile(join(cacheRoot, index.actors.actorb.blobRelativePath as string))).toEqual(validPngBytes);
    expect(networkClient.getContent).toHaveBeenCalledTimes(1);
  });

  it("prefers manual actor library images over cached remote images", async () => {
    const { root } = await createActorLibrary();
    const config = createConfig(root);
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const networkClient = {
      getContent: vi.fn(async () => validPngBytes),
    };
    const service = new ActorImageService({ networkClient });
    const manualPath = join(root, "Actor B.jpg");

    await service.prepareActorProfilesForMovie(config, {
      movieDir: join(root, "Movie"),
      actors: ["Actor B"],
      actorProfiles: [{ name: "Actor B", photo_url: "https://img.example.com/actor-b.png" }],
    });
    await writeFile(manualPath, "manual", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor B"]);

    expect(resolved).toBe(manualPath);
  });

  it("does not cache invalid remote actor image responses", async () => {
    const { root, cacheRoot } = await createActorLibrary();
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: root,
      },
    });
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: false,
      width: 0,
      height: 0,
      reason: "parse_failed",
    });
    const networkClient = {
      getContent: vi.fn(async () => Buffer.from("<html>blocked</html>", "utf8")),
    };
    const service = new ActorImageService({ networkClient });

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir: join(root, "Movie"),
      actors: ["Actor C"],
      actorProfiles: [{ name: "Actor C", photo_url: "https://img.example.com/actor-c.jpg" }],
    });
    const index = JSON.parse(await readFile(join(cacheRoot, "index.json"), "utf8")) as {
      actors: Record<string, unknown>;
    };

    expect(profiles).toEqual([{ name: "Actor C", photo_url: undefined }]);
    expect(index.actors.actorc).toBeUndefined();
  });

  it("retries actor source lookup after a crawler-provided photo fails to cache", async () => {
    const { root } = await createActorLibrary();
    const movieDir = join(root, "Movie");
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: root,
      },
    });
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const networkClient = {
      getContent: vi.fn(async (url: string) => {
        if (url.includes("broken.example.com")) {
          throw new Error("connect timeout");
        }
        return validPngBytes;
      }),
    };
    const actorSourceProvider = {
      lookup: vi.fn().mockResolvedValue({
        profile: {
          name: "Actor F",
          photo_url: "https://fallback.example.com/actor-f.png",
        },
        profileSources: {
          photo_url: "official",
        },
        sourceResults: [],
        warnings: [],
      }),
    } as unknown as ActorSourceProvider;
    const service = new ActorImageService({ networkClient });

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir,
      actors: ["Actor F"],
      actorProfiles: [{ name: "Actor F", photo_url: "https://broken.example.com/actor-f.png" }],
      actorSourceProvider,
    });

    expect(actorSourceProvider.lookup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        name: "Actor F",
        requiredField: "photo_url",
      }),
    );
    expect(profiles).toEqual([{ name: "Actor F", photo_url: ".actors/Actor F.png" }]);
    expect(await readFile(join(movieDir, ".actors", "Actor F.png"))).toEqual(validPngBytes);
  });

  it("reuses cached remote actor images after the actor photo folder path changes", async () => {
    const userDataDir = await createUserDataDir();
    const firstRoot = await createTempDir();
    const secondRoot = await createTempDir();
    const validPngBytes = await readValidPngBytes();
    vi.spyOn(imageUtils, "validateImage").mockResolvedValue({
      valid: true,
      width: 512,
      height: 512,
    });
    const networkClient = {
      getContent: vi.fn(async () => validPngBytes),
    };
    const service = new ActorImageService({ networkClient });

    await service.prepareActorProfilesForMovie(createConfig(firstRoot), {
      movieDir: join(firstRoot, "Movie"),
      actors: ["Actor D"],
      actorProfiles: [{ name: "Actor D", photo_url: "https://img.example.com/actor-d.png" }],
    });

    const profiles = await service.prepareActorProfilesForMovie(createConfig(secondRoot), {
      movieDir: join(secondRoot, "Movie"),
      actors: ["Actor D"],
      actorProfiles: [{ name: "Actor D", photo_url: "https://img.example.com/actor-d.png" }],
    });

    expect(userDataDir).toBeTruthy();
    expect(profiles).toEqual([{ name: "Actor D", photo_url: ".actors/Actor D.png" }]);
    expect(await readFile(join(secondRoot, "Movie", ".actors", "Actor D.png"))).toEqual(validPngBytes);
    expect(networkClient.getContent).toHaveBeenCalledTimes(1);
  });
});
