import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExistingNfoPath, NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { getNfoReadCandidates, resolveFilenameNfoPath } from "@mdcz/runtime/scrape";
import { NFO_FIELD_OPTIONS, type NfoField } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@mdcz/shared/types";
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
    const releaseParsed = parseNfoSnapshot(releaseXml).crawlerData;
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

    const parsed = parseNfoSnapshot(xml).crawlerData;

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
          bitrate: 8_000_000,
        },
      },
    );

    expect(xml).toContain("<fileinfo>");
    expect(xml).toContain("<streamdetails>");
    expect(xml).toContain("<video>");
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
    const parsed = parseNfoSnapshot(xml).crawlerData;

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
  it("orders read candidates according to naming mode and video basename", () => {
    expect(resolveFilenameNfoPath("/media/movie.nfo", "/media/ABC-123.mp4")).toBe("/media/ABC-123.nfo");
    expect(getNfoReadCandidates("/media/movie.nfo", "filename", "/media/ABC-123.mp4")).toEqual([
      "/media/ABC-123.nfo",
      "/media/movie.nfo",
    ]);
    expect(getNfoReadCandidates("/media/ABC-123.nfo", "movie", "/media/ABC-123.mp4")).toEqual([
      "/media/movie.nfo",
      "/media/ABC-123.nfo",
    ]);
  });
  it("merges editable fields without dropping unmanaged nodes or attributes", () => {
    const existingXml = `<?xml version="1.0"?><movie custom="keep"><title>Old</title><originaltitle>Old</originaltitle><uniqueid type="dmm" default="true">ABC-123</uniqueid><actor role="lead"><name>Actor A</name><thumb>actor.jpg</thumb></actor><fileinfo><streamdetails><video><width>1920</width></video></streamdetails></fileinfo><providerid source="local">keep-me</providerid><mdcz><custom keep="yes">value</custom></mdcz></movie>`;
    const merged = new NfoGenerator().mergeEditableXml(
      existingXml,
      createCrawlerData({ title: "New", actors: ["Actor A"] }),
    );

    expect(merged).toContain('<movie custom="keep">');
    expect(merged).toContain("<title>New</title>");
    expect(merged).toContain("<fileinfo>");
    expect(merged).toContain('<providerid source="local">keep-me</providerid>');
    expect(merged).toContain('<custom keep="yes">value</custom>');
    expect(merged).toContain('<actor role="lead">');
    expect(merged).toContain("<name>Actor A</name>");
  });
  it("writes configurable director and trailer fields without coupling trailer downloads", () => {
    const data = createCrawlerData({
      director: "Director",
      trailer_url: "https://example.com/trailer.mp4",
      trailer_source_url: "https://example.com/source-trailer.mp4",
    });
    const generator = new NfoGenerator();

    const defaults = generator.buildXml(data);
    expect(defaults).toContain("<director>Director</director>");
    expect(defaults).toContain("<trailer>https://example.com/trailer.mp4</trailer>");
    expect(defaults).toContain("<trailer_source_url>https://example.com/source-trailer.mp4</trailer_source_url>");

    const directorOnly = generator.buildXml(data, { assets: createAssets(), enabledFields: ["director"] });
    expect(directorOnly).toContain("<director>Director</director>");
    expect(directorOnly).not.toContain("<trailer>");
    expect(directorOnly).not.toContain("trailer_source_url");

    const trailerOnlyWithLocalAsset = generator.buildXml(data, {
      assets: createAssets(),
      enabledFields: ["trailer"],
    });
    expect(trailerOnlyWithLocalAsset).not.toContain("<director>");
    expect(trailerOnlyWithLocalAsset).toContain("<trailer>trailer.mp4</trailer>");
    expect(trailerOnlyWithLocalAsset).toContain(
      "<trailer_source_url>https://example.com/source-trailer.mp4</trailer_source_url>",
    );

    const neither = generator.buildXml(data, { enabledFields: [] });
    expect(neither).not.toContain("<director>");
    expect(neither).not.toContain("<trailer>");
    expect(neither).not.toContain("trailer_source_url");
  });
  it("gates optional NFO field groups while retaining core metadata", () => {
    const generator = new NfoGenerator();
    const data = createCrawlerData({
      title: "Original",
      title_zh: "中文标题",
      original_title: "Original",
      plot: "A long plot",
      release_date: "2024-01-02",
      durationSeconds: 3600,
      rating: 8.5,
      studio: "Studio",
      director: "Director",
      publisher: "Publisher",
      series: "Series",
      actors: ["Actor"],
      genres: ["Drama"],
      scene_images: ["https://example.com/scene.jpg"],
      poster_url: "https://example.com/poster.jpg",
      thumb_url: "https://example.com/thumb.jpg",
      fanart_url: "https://example.com/fanart.jpg",
      trailer_url: "https://example.com/trailer.mp4",
      poster_source_url: "https://example.com/poster-source.jpg",
      thumb_source_url: "https://example.com/thumb-source.jpg",
      fanart_source_url: "https://example.com/fanart-source.jpg",
      trailer_source_url: "https://example.com/trailer-source.mp4",
    });
    const assets = createAssets();
    const videoMeta = { width: 1920, height: 1080, durationSeconds: 3600 };
    const sources = { title: Website.DMM };
    const allFields: NfoField[] = [...NFO_FIELD_OPTIONS];

    const all = generator.buildXml(data, {
      assets,
      videoMeta,
      sources,
      enabledFields: allFields,
      buildTags: () => ["中字"],
    });
    expect(all).toContain("<plot>A long plot</plot>");
    expect(all).toContain("<num>ABC-123</num>");
    expect(all).toContain("<outline>A long plot</outline>");
    expect(all).toContain("<premiered>2024-01-02</premiered>");
    expect(all).toContain("<runtime>60</runtime>");
    expect(all).toContain("<rating>8.5</rating>");
    expect(all).toContain("<director>Director</director>");
    expect(all).toContain("<set>Series</set>");
    expect(all).toContain("<genre>Drama</genre>");
    expect(all).toContain("<tag>中字</tag>");
    expect(all).toContain('<thumb aspect="poster">poster.jpg</thumb>');
    expect(all).toContain('<thumb aspect="thumb">thumb.jpg</thumb>');
    expect(all).toContain("<fanart>");
    expect(all).toContain("<scene_images>");
    expect(all).toContain("<trailer>trailer.mp4</trailer>");
    expect(all).toContain("Aggregation Sources:");
    expect(all).toContain("<streamdetails>");
    expect(all).toContain("<actor>");

    const empty = generator.buildXml(data, { assets, videoMeta, sources, enabledFields: [] });
    expect(empty).toContain("<title>中文标题</title>");
    expect(empty).toContain("<originaltitle>Original</originaltitle>");
    expect(empty).toContain("<uniqueid");
    expect(empty).not.toContain("<num>");
    expect(empty).toContain("<actor>");
    expect(empty).toContain("<dateadded>");
    expect(empty).not.toContain("<plot>");
    expect(empty).not.toContain("<premiered>");
    expect(empty).not.toContain("<runtime>");
    expect(empty).not.toContain("<rating>");
    expect(empty).not.toContain("<director>");
    expect(empty).not.toContain("<genre>");
    expect(empty).not.toContain("<tag>");
    expect(empty).not.toContain("<thumb");
    expect(empty).not.toContain("<fanart>");
    expect(empty).not.toContain("<trailer>");
    expect(empty).not.toContain("<fileinfo>");
    expect(empty).not.toContain("Aggregation Sources:");
    expect(empty).not.toContain("<scene_images>");
    expect(empty).not.toContain("poster-source.jpg");
    expect(empty).not.toContain("trailer-source.mp4");

    const optionalFieldTokens: Record<NfoField, string[]> = {
      num: ["<num>"],
      plot: ["<plot>", "<outline>"],
      release: ["<premiered>", "<releasedate>", "<year>"],
      runtime: ["<runtime>"],
      fileinfo: ["<fileinfo>", "<streamdetails>"],
      rating: ["<rating>"],
      studio: ["<studio>"],
      director: ["<director>"],
      publisher: ["<publisher>"],
      series: ["<set>"],
      genres: ["<genre>"],
      tags: ["<tag>"],
      poster: ['<thumb aspect="poster">', "<poster_source_url>"],
      thumb: ['<thumb aspect="thumb">', "<thumb_source_url>"],
      fanart: ["<fanart>", "<fanart_source_url>"],
      sceneImages: ["<scene_images>"],
      trailer: ["<trailer>", "<trailer_source_url>"],
      sourceComment: ["Aggregation Sources:"],
    };

    const omittedPolicy = generator.buildXml(data, {
      assets,
      videoMeta,
      sources,
      buildTags: () => ["中字"],
    });
    for (const tokens of Object.values(optionalFieldTokens)) {
      for (const token of tokens) {
        expect(omittedPolicy).toContain(token);
        expect(empty).not.toContain(token);
      }
    }

    for (const disabledField of NFO_FIELD_OPTIONS) {
      const enabledFields = NFO_FIELD_OPTIONS.filter((field) => field !== disabledField);
      const xml = generator.buildXml(data, {
        assets,
        videoMeta,
        sources,
        enabledFields,
        buildTags: () => ["中字"],
      });
      for (const field of NFO_FIELD_OPTIONS) {
        const tokens = optionalFieldTokens[field];
        for (const token of tokens) {
          if (field === disabledField) {
            expect(xml).not.toContain(token);
          } else {
            expect(xml).toContain(token);
          }
        }
      }
      expect(xml).toContain("<title>中文标题</title>");
      expect(xml).toContain("<originaltitle>Original</originaltitle>");
      expect(xml).toContain("<uniqueid");
      expect(xml).toContain("<actor>");
      expect(xml).toContain("<dateadded>");
    }

    const customTitleWithEmptyPolicy = generator.buildXml(data, {
      nfoTitleTemplate: "{number} {title}",
      enabledFields: [],
    });
    expect(customTitleWithEmptyPolicy).toContain("<raw_title>中文标题</raw_title>");
    expect(customTitleWithEmptyPolicy).not.toContain("<poster_source_url>");
    expect(customTitleWithEmptyPolicy).not.toContain("<thumb_source_url>");
    expect(customTitleWithEmptyPolicy).not.toContain("<fanart_source_url>");
    expect(customTitleWithEmptyPolicy).not.toContain("<trailer_source_url>");
    expect(customTitleWithEmptyPolicy).not.toContain("<scene_images>");
  });

  it("keeps fanart fallback metadata independent from the thumb field", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        thumb_url: "thumb.jpg",
        thumb_source_url: "https://example.com/original-thumb.jpg",
      }),
      { enabledFields: ["fanart"] },
    );

    expect(xml).toContain("<fanart>");
    expect(xml).toContain("<thumb>thumb.jpg</thumb>");
    expect(xml).toContain("<fanart_source_url>https://example.com/original-thumb.jpg</fanart_source_url>");
    expect(xml).not.toContain("<thumb_source_url>");
  });
});
