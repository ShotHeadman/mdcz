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

  it("returns empty items for an empty directory", async () => {
    const root = await createTempDir();
    const { service } = createService();

    const items = await service.scan(root);

    expect(items).toEqual([]);
  });

  it("recursively finds .nfo files in nested directories", async () => {
    const root = await createTempDir();
    const nested = join(root, "nested", "child");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AAA-001.nfo"), createNfoXml({ title: "Title A", number: "AAA-001" }), "utf8");
    await writeFile(join(nested, "BBB-002.nfo"), createNfoXml({ title: "Title B", number: "BBB-002" }), "utf8");

    const { service } = createService();
    const items = await service.scan(root);

    expect(items.map((item) => item.number)).toEqual(["AAA-001", "BBB-002"]);
  });

  it("uses originaltitle when parsing NFO titles", async () => {
    const root = await createTempDir();
    await writeFile(
      join(root, "ABF-075.nfo"),
      createNfoXml({
        title: "中文标题",
        originaltitle: "天然成分由来 瀧本雫葉汁 120% 83",
        number: "ABF-075",
      }),
      "utf8",
    );

    const { service } = createService();
    const items = await service.scan(root);

    expect(items[0]?.title).toBe("天然成分由来 瀧本雫葉汁 120% 83");
  });

  it("returns null poster info when poster.jpg is missing", async () => {
    const root = await createTempDir();
    await writeFile(join(root, "ABC-123.nfo"), createNfoXml({ title: "Title", number: "ABC-123" }), "utf8");

    const { service } = createService();
    const items = await service.scan(root);

    expect(items[0]).toMatchObject({
      currentPosterPath: null,
      currentPosterWidth: 0,
      currentPosterHeight: 0,
      currentPosterSize: 0,
    });
  });

  it("returns existing poster dimensions and file size", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "poster.jpg");
    const posterContent = Buffer.alloc(12_345, 1);
    await writeFile(join(root, "ABC-123.nfo"), createNfoXml({ title: "Title", number: "ABC-123" }), "utf8");
    await writeFile(posterPath, posterContent);
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1500, height: 1012 });

    const { service } = createService();
    const items = await service.scan(root);

    expect(items[0]).toMatchObject({
      currentPosterPath: posterPath,
      currentPosterWidth: 1500,
      currentPosterHeight: 1012,
      currentPosterSize: posterContent.length,
    });
  });

  it("returns null amazon url when lookup finds no result", async () => {
    const root = await createTempDir();
    const enhance = vi.fn(async () => ({ upgraded: false, reason: "搜索无结果" }));
    const { service } = createService({ enhance });

    const result = await service.lookup(join(root, "ABC-123.nfo"), "Lookup Title");

    expect(result.amazonPosterUrl).toBeNull();
    expect(result.reason).toBe("搜索无结果");
  });

  it("returns amazon url on hit and does not write poster.jpg during lookup", async () => {
    const root = await createTempDir();
    const posterPath = join(root, "poster.jpg");
    const enhance = vi.fn(async () => ({
      upgraded: true,
      reason: "已升级为Amazon商品海报",
      poster_url: "https://m.media-amazon.com/images/I/81test._AC_SL1500_.jpg",
    }));
    const { service } = createService({ enhance });

    const result = await service.lookup(join(root, "ABC-123.nfo"), "Lookup Title");

    expect(result.amazonPosterUrl).toBe("https://m.media-amazon.com/images/I/81test._AC_SL1500_.jpg");
    expect(enhance).toHaveBeenCalledTimes(1);
    const firstCall = enhance.mock.calls.at(0) as unknown[] | undefined;
    expect(firstCall?.[0] as Record<string, unknown> | undefined).toMatchObject({
      title: "Lookup Title",
      poster_url: "lookup",
    });
    expect(firstCall).toHaveLength(1);
    await expect(stat(posterPath)).rejects.toThrow();
  });

  it("replaces an existing poster.jpg during apply", async () => {
    const root = await createTempDir();
    const existingPosterPath = join(root, "poster.jpg");
    await writeFile(existingPosterPath, Buffer.from("old-poster"));

    const newCoverContent = Buffer.alloc(14_000, 2);
    const download = vi.fn(async (_url: string, outputPath: string) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, newCoverContent);
      return outputPath;
    });
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1500, height: 1012 });

    const { service } = createService({ download });
    const results = await service.apply([{ directory: root, amazonPosterUrl: "https://example.com/poster.jpg" }]);
    const savedContent = await readFile(existingPosterPath);

    expect(results[0]).toMatchObject({
      directory: root,
      success: true,
      savedPosterPath: existingPosterPath,
      replacedExisting: true,
      fileSize: newCoverContent.length,
    });
    expect(savedContent).toEqual(newCoverContent);
  });

  it("creates a new poster.jpg during apply when none exists", async () => {
    const root = await createTempDir();
    const createdPosterPath = join(root, "poster.jpg");
    const newCoverContent = Buffer.alloc(15_000, 3);

    const download = vi.fn(async (_url: string, outputPath: string) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, newCoverContent);
      return outputPath;
    });
    validateImageMock.mockResolvedValueOnce({ valid: true, width: 1200, height: 800 });

    const { service } = createService({ download });
    const results = await service.apply([{ directory: root, amazonPosterUrl: "https://example.com/new-poster.jpg" }]);

    expect(results[0]).toMatchObject({
      directory: root,
      success: true,
      savedPosterPath: createdPosterPath,
      replacedExisting: false,
      fileSize: newCoverContent.length,
    });
    await expect(stat(createdPosterPath)).resolves.toBeTruthy();
  });

  it("returns failure details when apply download fails", async () => {
    const root = await createTempDir();
    const download = vi.fn(async () => {
      throw new Error("download failed");
    });

    const { service } = createService({ download });
    const results = await service.apply([{ directory: root, amazonPosterUrl: "https://example.com/fail.jpg" }]);

    expect(results[0]).toMatchObject({
      directory: root,
      success: false,
      replacedExisting: false,
      fileSize: 0,
    });
    expect(results[0]?.error).toContain("download failed");
  });
});
