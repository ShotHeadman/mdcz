import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfo } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
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
  sample_images: [],
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

describe("NfoGenerator", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("uses crawler duration when local video metadata is unavailable", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
    );

    expect(xml).toContain("<runtime>90</runtime>");
  });

  it("prefers local video metadata duration over crawler duration", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
      {
        videoMeta: {
          durationSeconds: 3600,
          width: 1920,
          height: 1080,
        },
      },
    );

    expect(xml).toContain("<runtime>60</runtime>");
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
    expect(xml).toContain("<tag>Drama</tag>");
    expect(xml).toContain("<tag>mdcz:content_type:VR</tag>");
    expect(xml).not.toContain("<altname>");
    expect(xml).not.toContain("<biography>");
    expect(xml).not.toContain("<website>");
  });

  it("round-trips Jellyfin-supported set and release date fields", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        series: "Collection",
        release_date: "2024-01-02",
      }),
    );

    const parsed = parseNfo(xml);

    expect(parsed.series).toBe("Collection");
    expect(parsed.release_date).toBe("2024-01-02");
  });

  it("writes year from release_date when available", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        release_date: "2024-01-02",
      }),
    );

    expect(xml).toContain("<year>2024</year>");
  });

  it("omits year when release_date is missing", () => {
    const xml = new NfoGenerator().buildXml(createCrawlerData());

    expect(xml).not.toContain("<year>");
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
    expect(parsed.poster_source_url).toBe("https://remote.example.com/poster.jpg");
    expect(parsed.thumb_source_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.fanart_source_url).toBe("https://remote.example.com/fanart.jpg");
    expect(parsed.sample_images).toEqual([]);
  });

  it("writes streamdetails when local video metadata is available", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
      {
        videoMeta: {
          durationSeconds: 3600,
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

  it("uses thumb artwork as fallback fanart and does not persist sample images into NFO", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        thumb_url: "https://remote.example.com/thumb.jpg",
        thumb_source_url: "https://remote.example.com/thumb.jpg",
        sample_images: ["https://remote.example.com/scene-001.jpg", "https://remote.example.com/scene-002.jpg"],
      }),
    );
    const parsed = parseNfo(xml);

    expect(xml).toContain("<fanart>");
    expect(parsed.fanart_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.fanart_source_url).toBe("https://remote.example.com/thumb.jpg");
    expect(parsed.sample_images).toEqual([]);
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
});
