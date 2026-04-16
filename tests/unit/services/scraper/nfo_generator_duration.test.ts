import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExistingNfoPath, NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfo } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@shared/types";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-nfo-generator-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAssets = (): DownloadedAssets => ({
  thumb: "/tmp/out/thumb.jpg",
  poster: "/tmp/out/poster.jpg",
  fanart: "/tmp/out/fanart.jpg",
  trailer: "/tmp/out/trailer.mp4",
  sceneImages: ["/tmp/out/extrafanart/fanart1.jpg"],
  downloaded: [
    "/tmp/out/thumb.jpg",
    "/tmp/out/poster.jpg",
    "/tmp/out/fanart.jpg",
    "/tmp/out/trailer.mp4",
    "/tmp/out/extrafanart/fanart1.jpg",
  ],
});

const createFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  filePath: "/tmp/ABC-123.mp4",
  fileName: "ABC-123",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
  ...overrides,
});

describe("NfoGenerator", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("writes runtime from the highest-priority duration source", () => {
    const cases = [
      {
        input: createCrawlerData({
          durationSeconds: 5400,
        }),
        options: undefined,
        expectedRuntime: 90,
      },
      {
        input: createCrawlerData({
          durationSeconds: 5400,
        }),
        options: {
          videoMeta: {
            durationSeconds: 3600,
            width: 1920,
            height: 1080,
          },
        },
        expectedRuntime: 60,
      },
    ];

    for (const { input, options, expectedRuntime } of cases) {
      const xml = new NfoGenerator().buildXml(input, options);
      expect(xml).toContain(`<runtime>${expectedRuntime}</runtime>`);
    }
  });

  it("prefers local assets and preserves actor photos in the generated XML", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [
          {
            name: "Actor A",
            aliases: ["Alias A"],
            description: "Actor biography",
            photo_url: "https://img.example.com/actor-a.jpg",
          },
        ],
        content_type: "VR",
        publisher: "PRESTIGE",
        genres: ["Drama"],
        studio: "Studio",
        director: "Director",
        series: "Series",
        plot: "Plot",
        release_date: "2024-01-02",
      }),
      {
        assets: createAssets(),
      },
    );

    expect(xml).toContain('<thumb aspect="poster">poster.jpg</thumb>');
    expect(xml).toContain('<thumb aspect="thumb">thumb.jpg</thumb>');
    expect(xml).toContain("<fanart>");
    expect(xml).toContain("<thumb>fanart.jpg</thumb>");
    expect(xml).toContain("<trailer>trailer.mp4</trailer>");
    expect(xml).toContain("<releasedate>2024-01-02</releasedate>");
    expect(xml).toContain("<outline>Plot</outline>");
    expect(xml).toContain("<dateadded>");
    expect(xml).toContain("<publisher>PRESTIGE</publisher>");
    expect(xml).toContain("<mpaa>JP-18+</mpaa>");
    expect(xml).not.toContain("<mpaa>XXX</mpaa>");
    expect(xml).toContain("<name>Actor A</name>");
    expect(xml).toContain("<type>Actor</type>");
    expect(xml).toContain("<thumb>https://img.example.com/actor-a.jpg</thumb>");
    expect(xml).toContain("<order>0</order>");
    expect(xml).toContain("<sortorder>0</sortorder>");
    expect(xml).not.toContain("<tag>Drama</tag>");
    expect(xml).toContain("<tag>mdcz:content_type:VR</tag>");
    expect(xml).not.toContain("<altname>");
    expect(xml).not.toContain("<biography>");
    expect(xml).not.toContain("<website>");
  });

  it("injects classification tags when fileInfo is provided", () => {
    const uncensoredXml = new NfoGenerator().buildXml(createCrawlerData(), {
      fileInfo: createFileInfo({
        isSubtitled: true,
        subtitleTag: "中文字幕",
        isUncensored: true,
      }),
    });
    expect(uncensoredXml).toContain("<tag>无码</tag>");
    expect(uncensoredXml).toContain("<tag>中文字幕</tag>");

    for (const fileInfo of [
      createFileInfo({
        isSubtitled: true,
      }),
      createFileInfo({
        isSubtitled: true,
        subtitleTag: "字幕",
      }),
    ]) {
      const subtitleXml = new NfoGenerator().buildXml(createCrawlerData(), {
        fileInfo,
      });
      expect(subtitleXml).toContain("<tag>字幕</tag>");
      expect(subtitleXml).not.toContain("<tag>中文字幕</tag>");
    }

    const umrXml = new NfoGenerator().buildXml(
      createCrawlerData({
        title: "高清无码 破解版",
      }),
      {
        fileInfo: createFileInfo(),
      },
    );
    expect(umrXml).toContain("<tag>破解</tag>");
    expect(umrXml).not.toContain("<tag>无码</tag>");

    const leakXml = new NfoGenerator().buildXml(
      createCrawlerData({
        genres: ["流出"],
      }),
      {
        fileInfo: createFileInfo(),
      },
    );
    expect(leakXml).toContain("<tag>流出</tag>");
    expect(leakXml).not.toContain("<tag>无码</tag>");
  });

  it("persists local NFO tags even when fileInfo is unavailable", () => {
    const xml = new NfoGenerator().buildXml(createCrawlerData(), {
      localState: {
        uncensoredChoice: "umr",
        tags: ["中文字幕", "自定义标签"],
      },
    });

    expect(xml).toContain("<tag>破解</tag>");
    expect(xml).toContain("<tag>中文字幕</tag>");
    expect(xml).toContain("<tag>自定义标签</tag>");
  });

  it("round-trips release metadata and derives year only when available", () => {
    const releaseXml = new NfoGenerator().buildXml(
      createCrawlerData({
        series: "Collection",
        release_date: "2024-01-02",
      }),
    );
    const releaseParsed = parseNfo(releaseXml);
    expect(releaseParsed.series).toBe("Collection");
    expect(releaseParsed.release_date).toBe("2024-01-02");
    expect(releaseXml).toContain("<year>2024</year>");

    const missingYearXml = new NfoGenerator().buildXml(createCrawlerData());
    expect(missingYearXml).not.toContain("<year>");
  });

  it("preserves local poster, cover, and trailer references when parsed back", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        poster_url: "https://remote.example.com/poster.jpg",
        thumb_url: "https://remote.example.com/thumb.jpg",
        fanart_url: "https://remote.example.com/fanart.jpg",
        poster_source_url: "https://remote.example.com/poster.jpg",
        thumb_source_url: "https://remote.example.com/thumb.jpg",
        fanart_source_url: "https://remote.example.com/fanart.jpg",
        trailer_url: "https://remote.example.com/trailer.mp4",
        trailer_source_url: "https://remote.example.com/trailer.mp4",
      }),
      {
        assets: createAssets(),
      },
    );

    const parsed = parseNfo(xml);

    expect(parsed.poster_url).toBe("poster.jpg");
    expect(parsed.thumb_url).toBe("thumb.jpg");
    expect(parsed.trailer_url).toBe("trailer.mp4");
    expect(parsed.fanart_url).toBe("fanart.jpg");
    expect(xml).toContain("<mdcz>");
    expect(parsed.poster_source_url).toBe("https://remote.example.com/poster.jpg");
    expect(parsed.thumb_source_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.fanart_source_url).toBe("https://remote.example.com/fanart.jpg");
    expect(parsed.trailer_source_url).toBe("https://remote.example.com/trailer.mp4");
    expect(parsed.scene_images).toEqual([]);
  });

  it("writes streamdetails when local video metadata is available", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
      {
        videoMeta: {
          durationSeconds: 3600.9,
          width: 1920,
          height: 1080,
          codec: "h264",
          bitrate: 8_000_000,
        },
      },
    );

    expect(xml).toContain("<fileinfo>");
    expect(xml).toContain("<streamdetails>");
    expect(xml).toContain("<video>");
    expect(xml).toContain("<codec>h264</codec>");
    expect(xml).toContain("<width>1920</width>");
    expect(xml).toContain("<height>1080</height>");
    expect(xml).toContain("<durationinseconds>3600</durationinseconds>");
    expect(xml).toContain("<bitrate>8000000</bitrate>");
  });

  it("writes a standards-compliant uniqueid attribute for Jellyfin", () => {
    const xml = new NfoGenerator().buildXml(createCrawlerData());
    expect(xml).toContain('<uniqueid type="dmm" default="true">ABC-123</uniqueid>');
  });

  it("supports originaltitle in the NFO title template", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        title: "Original Title",
        title_zh: "中文标题",
      }),
      {
        nfoTitleTemplate: "{number} {originaltitle}",
      },
    );

    expect(xml).toContain("<title>ABC-123 Original Title</title>");
    expect(xml).toContain("<originaltitle>Original Title</originaltitle>");
  });

  it("uses thumb artwork as fallback fanart and persists sample image urls under mdcz", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        thumb_url: "https://remote.example.com/thumb.jpg",
        thumb_source_url: "https://remote.example.com/thumb.jpg",
        scene_images: ["https://remote.example.com/scene-001.jpg", "https://remote.example.com/scene-002.jpg"],
      }),
    );
    const parsed = parseNfo(xml);

    expect(xml).toContain("<fanart>");
    expect(xml).toContain("<mdcz>");
    expect(xml).toContain("<scene_images>");
    expect(parsed.fanart_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.fanart_source_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.scene_images).toEqual([
      "https://remote.example.com/scene-001.jpg",
      "https://remote.example.com/scene-002.jpg",
    ]);
    expect(parsed.thumb_url).toBe("https://remote.example.com/thumb.jpg");
  });

  it("writes both the primary NFO and a Jellyfin-compatible movie.nfo copy", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123.nfo");
    const movieNfoPath = join(root, "movie.nfo");
    const generator = new NfoGenerator();

    await generator.writeNfo(
      nfoPath,
      createCrawlerData({
        title: "Sample Title",
      }),
    );

    await expect(readFile(nfoPath, "utf8")).resolves.toContain("<title>Sample Title</title>");
    await expect(readFile(movieNfoPath, "utf8")).resolves.toBe(await readFile(nfoPath, "utf8"));
  });

  it("finds an existing movie.nfo when movie naming mode is enabled", async () => {
    const root = await createTempDir();
    const nfoPath = join(root, "ABC-123.nfo");
    const movieNfoPath = join(root, "movie.nfo");

    await writeFile(movieNfoPath, "<movie />", "utf8");

    await expect(findExistingNfoPath(nfoPath, "movie")).resolves.toBe(movieNfoPath);
  });
});
