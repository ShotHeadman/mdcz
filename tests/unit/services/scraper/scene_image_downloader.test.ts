import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SceneImageDownloader } from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scene-image-downloader-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const writeSceneCandidate = async (filePath: string, content: string): Promise<string> => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
};

describe("SceneImageDownloader", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("falls back to a later scene image set when the first set is incomplete", async () => {
    const root = await createTempDir();
    const downloadValidatedImageCandidate = vi.fn(async (url: string, outputPath: string) => {
      if (url === "https://set1.example.com/1.jpg") {
        return {
          status: "downloaded" as const,
          path: await writeSceneCandidate(outputPath, "set1-1"),
          width: 1_200,
          height: 800,
        };
      }

      if (url === "https://set1.example.com/2.jpg") {
        return { status: "skipped" as const, reason: "download_failed" as const };
      }

      const content = url.endsWith("/1.jpg") ? "set2-1" : "set2-2";
      return {
        status: "downloaded" as const,
        path: await writeSceneCandidate(outputPath, content),
        width: 1_200,
        height: 800,
      };
    });
    const hostCooldown = {
      filterUrls: vi.fn((urls: string[]) => urls),
      shouldSkipUrl: vi.fn(() => false),
    };
    const logger = { info: vi.fn() };
    const downloader = new SceneImageDownloader(
      { downloadValidatedImageCandidate } as never,
      hostCooldown as never,
      logger,
    );

    const result = await downloader.downloadSceneImageSets({
      outputDir: root,
      sceneFolder: "extrafanart",
      sceneImageSets: [
        {
          urls: ["https://set1.example.com/1.jpg", "https://set1.example.com/2.jpg"],
        },
        {
          urls: ["https://set2.example.com/1.jpg", "https://set2.example.com/2.jpg"],
        },
      ],
      targetSceneCount: 2,
      maxConcurrent: 2,
      dedupeAgainstPaths: [],
    });

    expect(result.map((item) => item.url)).toEqual([
      "https://set2.example.com/1.jpg",
      "https://set2.example.com/2.jpg",
    ]);
    await expect(readFile(result[0]?.path ?? "", "utf8")).resolves.toBe("set2-1");
    await expect(readFile(result[1]?.path ?? "", "utf8")).resolves.toBe("set2-2");
    await expect(access(join(root, "extrafanart", ".scene-set-01-candidate-001.jpg"))).rejects.toThrow();
  });

  it("skips downloaded scene images that duplicate an existing asset signature", async () => {
    const root = await createTempDir();
    const existingPath = join(root, "thumb.jpg");
    await writeFile(existingPath, "duplicate-image", "utf8");

    const downloadValidatedImageCandidate = vi.fn(async (url: string, outputPath: string) => {
      const content = url.includes("duplicate") ? "duplicate-image" : "unique-image";
      return {
        status: "downloaded" as const,
        path: await writeSceneCandidate(outputPath, content),
        width: 1_200,
        height: 800,
      };
    });
    const downloader = new SceneImageDownloader(
      { downloadValidatedImageCandidate } as never,
      {
        filterUrls: vi.fn((urls: string[]) => urls),
        shouldSkipUrl: vi.fn(() => false),
      } as never,
      { info: vi.fn() },
    );

    const result = await downloader.downloadSceneImageSets({
      outputDir: root,
      sceneFolder: "extrafanart",
      sceneImageSets: [
        {
          urls: ["https://img.example.com/duplicate.jpg", "https://img.example.com/unique.jpg"],
        },
      ],
      targetSceneCount: 2,
      maxConcurrent: 2,
      dedupeAgainstPaths: [existingPath],
    });

    expect(result.map((item) => item.url)).toEqual(["https://img.example.com/unique.jpg"]);
    await expect(readFile(result[0]?.path ?? "", "utf8")).resolves.toBe("unique-image");
    await expect(access(join(root, "extrafanart", ".scene-set-01-candidate-001.jpg"))).rejects.toThrow();
  });
});
