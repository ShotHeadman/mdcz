import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { NetworkClient } from "@main/services/network";
import type { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { AmazonPosterToolService } from "@main/services/tools/AmazonPosterToolService";
import { Website } from "@shared/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validateImageMock } = vi.hoisted(() => ({
  validateImageMock: vi.fn(),
}));

vi.mock("@main/utils/image", () => ({
  validateImage: validateImageMock,
}));

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-amazon-poster-tool-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createNfoXml = ({
  title,
  number,
  website = Website.JAVDB,
  originaltitle,
}: {
  title: string;
  number: string;
  website?: Website;
  originaltitle?: string;
}) => `
  <movie>
    <title>${title}</title>
    ${originaltitle ? `<originaltitle>${originaltitle}</originaltitle>` : ""}
    <uniqueid type="${website}">${number}</uniqueid>
    <website>${website}</website>
  </movie>
`;

const createService = (options?: {
  download?: (url: string, outputPath: string) => Promise<string>;
  enhance?: AmazonJpImageService["enhance"];
}) => {
  const networkClient = {
    download: vi.fn(options?.download ?? (async (_url: string, outputPath: string) => outputPath)),
  } as unknown as NetworkClient;

  const amazonJpImageService = {
    enhance:
      options?.enhance ??
      vi.fn(async () => ({
        upgraded: false,
        reason: "搜索无结果",
      })),
  } as unknown as AmazonJpImageService;

  return {
    service: new AmazonPosterToolService(networkClient, amazonJpImageService),
    networkClient,
    amazonJpImageService,
  };
};

describe("AmazonPosterToolService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateImageMock.mockReset();
    validateImageMock.mockResolvedValue({
      valid: true,
      width: 800,
      height: 538,
    });
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("scans nested NFOs, prefers original titles, and reports poster metadata when available", async () => {
    const root = await createTempDir();
    const nested = join(root, "nested", "child");
    const posterPath = join(root, "poster.jpg");
    const posterContent = Buffer.alloc(12_345, 1);

    await mkdir(nested, { recursive: true });
    await writeFile(
      join(root, "AAA-001.nfo"),
      createNfoXml({
        title: "中文标题",
        originaltitle: "天然成分由来 瀧本雫葉汁 120% 83",
        number: "AAA-001",
      }),
      "utf8",
    );
    await writeFile(join(nested, "BBB-002.nfo"), createNfoXml({ title: "Title B", number: "BBB-002" }), "utf8");
    await writeFile(posterPath, posterContent);
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1500, height: 1012 });

    const { service } = createService();
    const items = await service.scan(root);

    expect(items.map((item) => item.number)).toEqual(["AAA-001", "BBB-002"]);
    expect(items[0]).toMatchObject({
      title: "天然成分由来 瀧本雫葉汁 120% 83",
      currentPosterPath: posterPath,
      currentPosterWidth: 1500,
      currentPosterHeight: 1012,
      currentPosterSize: posterContent.length,
    });
    expect(items[1]).toMatchObject({
      currentPosterPath: null,
      currentPosterWidth: 0,
      currentPosterHeight: 0,
      currentPosterSize: 0,
    });
  });

  it("returns empty scan results for empty directories", async () => {
    const root = await createTempDir();
    const { service } = createService();

    await expect(service.scan(root)).resolves.toEqual([]);
  });

  it("returns lookup misses without writing posters and reports successful Amazon hits", async () => {
    const missRoot = await createTempDir();
    const missEnhance = vi.fn(async () => ({ upgraded: false, reason: "搜索无结果" }));
    const missService = createService({ enhance: missEnhance }).service;

    const missResult = await missService.lookup(join(missRoot, "ABC-123.nfo"), "Lookup Title");
    expect(missResult.amazonPosterUrl).toBeNull();
    expect(missResult.reason).toBe("搜索无结果");

    const hitRoot = await createTempDir();
    const posterPath = join(hitRoot, "poster.jpg");
    const hitEnhance = vi.fn(async () => ({
      upgraded: true,
      reason: "已升级为Amazon商品海报",
      poster_url: "https://m.media-amazon.com/images/I/81test._AC_SL1500_.jpg",
    }));
    const { service } = createService({ enhance: hitEnhance });

    const hitResult = await service.lookup(join(hitRoot, "ABC-123.nfo"), "Lookup Title");

    expect(hitResult.amazonPosterUrl).toBe("https://m.media-amazon.com/images/I/81test._AC_SL1500_.jpg");
    expect(hitEnhance).toHaveBeenCalledTimes(1);
    const firstCall = hitEnhance.mock.calls.at(0) as unknown[] | undefined;
    expect(firstCall?.[0] as Record<string, unknown> | undefined).toMatchObject({
      title: "Lookup Title",
      poster_url: "lookup",
    });
    expect(firstCall).toHaveLength(1);
    await expect(stat(posterPath)).rejects.toThrow();
  });

  it("applies poster downloads by replacing, creating, or reporting failures", async () => {
    const replaceRoot = await createTempDir();
    const existingPosterPath = join(replaceRoot, "poster.jpg");
    await writeFile(existingPosterPath, Buffer.from("old-poster"));
    const replacementContent = Buffer.alloc(14_000, 2);
    const replaceDownload = vi.fn(async (_url: string, outputPath: string) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, replacementContent);
      return outputPath;
    });
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1500, height: 1012 });
    const replaceService = createService({ download: replaceDownload }).service;

    const replaceResults = await replaceService.apply([
      { directory: replaceRoot, amazonPosterUrl: "https://example.com/poster.jpg" },
    ]);
    expect(replaceResults[0]).toMatchObject({
      directory: replaceRoot,
      success: true,
      savedPosterPath: existingPosterPath,
      replacedExisting: true,
      fileSize: replacementContent.length,
    });
    await expect(readFile(existingPosterPath)).resolves.toEqual(replacementContent);

    const createRoot = await createTempDir();
    const createdPosterPath = join(createRoot, "poster.jpg");
    const createContent = Buffer.alloc(15_000, 3);
    const createDownload = vi.fn(async (_url: string, outputPath: string) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, createContent);
      return outputPath;
    });
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1200, height: 800 });
    const createServiceResult = createService({ download: createDownload }).service;

    const createResults = await createServiceResult.apply([
      { directory: createRoot, amazonPosterUrl: "https://example.com/new-poster.jpg" },
    ]);
    expect(createResults[0]).toMatchObject({
      directory: createRoot,
      success: true,
      savedPosterPath: createdPosterPath,
      replacedExisting: false,
      fileSize: createContent.length,
    });
    await expect(stat(createdPosterPath)).resolves.toBeTruthy();

    const failureRoot = await createTempDir();
    const failureDownload = vi.fn(async () => {
      throw new Error("download failed");
    });
    const failureService = createService({ download: failureDownload }).service;

    const failureResults = await failureService.apply([
      { directory: failureRoot, amazonPosterUrl: "https://example.com/fail.jpg" },
    ]);
    expect(failureResults[0]).toMatchObject({
      directory: failureRoot,
      success: false,
      replacedExisting: false,
      fileSize: 0,
    });
    expect(failureResults[0]?.error).toContain("download failed");
  });
});
