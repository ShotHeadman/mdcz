import { buildMovieTags, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import { NfoGenerator } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

describe("parseNfo", () => {
  it("refuses to write an MDCz NFO without an originating website", () => {
    expect(() =>
      new NfoGenerator().buildXml({
        title: "No Source",
        number: "ABC-000",
        actors: [],
        genres: [],
        scene_images: [],
      }),
    ).toThrow("NFO missing website");
  });

  it("reads poster, thumb, and fanart by aspect", () => {
    const xml = `
      <movie>
        <title>中文标题</title>
        <originaltitle>Original Title</originaltitle>
        <uniqueid type="${Website.JAVDB}">ABC-123</uniqueid>
        <thumb aspect="poster">poster.jpg</thumb>
        <thumb aspect="thumb">thumb.jpg</thumb>
        <fanart>
          <thumb>fanart.jpg</thumb>
        </fanart>
      </movie>
    `;

    const result = parseNfoSnapshot(xml).crawlerData;

    expect(result.title).toBe("Original Title");
    expect(result.title_zh).toBe("中文标题");
    expect(result.thumb_url).toBe("thumb.jpg");
    expect(result.poster_url).toBe("poster.jpg");
    expect(result.fanart_url).toBe("fanart.jpg");
    expect(result.scene_images).toEqual([]);
  });

  it("falls back to the first aspectless thumb", () => {
    const xml = `
      <movie>
        <title>Only Thumb</title>
        <uniqueid type="${Website.JAVBUS}">DEF-456</uniqueid>
        <thumb>https://example.com/thumb.jpg</thumb>
      </movie>
    `;

    const result = parseNfoSnapshot(xml).crawlerData;

    expect(result.thumb_url).toBe("https://example.com/thumb.jpg");
    expect(result.poster_url).toBeUndefined();
  });

  it("reads persisted remote asset source urls independently from local file paths", () => {
    const xml = `
      <movie>
        <title>Source Urls</title>
        <uniqueid type="${Website.DMM}">SRC-001</uniqueid>
        <thumb aspect="poster">poster.jpg</thumb>
        <thumb aspect="thumb">thumb.jpg</thumb>
        <fanart>
          <thumb>fanart.jpg</thumb>
        </fanart>
        <mdcz>
          <thumb_source_url>https://example.com/thumb-remote.jpg</thumb_source_url>
          <poster_source_url>https://example.com/poster-remote.jpg</poster_source_url>
          <fanart_source_url>https://example.com/fanart-remote.jpg</fanart_source_url>
          <trailer_source_url>https://example.com/trailer-remote.mp4</trailer_source_url>
          <scene_images>
            <image>https://example.com/scene-001.jpg</image>
            <image>https://example.com/scene-002.jpg</image>
          </scene_images>
        </mdcz>
        <trailer>trailer.mp4</trailer>
      </movie>
    `;

    const result = parseNfoSnapshot(xml).crawlerData;

    expect(result.thumb_url).toBe("thumb.jpg");
    expect(result.poster_url).toBe("poster.jpg");
    expect(result.fanart_url).toBe("fanart.jpg");
    expect(result.thumb_source_url).toBe("https://example.com/thumb-remote.jpg");
    expect(result.poster_source_url).toBe("https://example.com/poster-remote.jpg");
    expect(result.fanart_source_url).toBe("https://example.com/fanart-remote.jpg");
    expect(result.trailer_source_url).toBe("https://example.com/trailer-remote.mp4");
    expect(result.trailer_url).toBe("trailer.mp4");
    expect(result.scene_images).toEqual(["https://example.com/scene-001.jpg", "https://example.com/scene-002.jpg"]);
  });

  it("round-trips standard metadata while preserving the original and translated plot", () => {
    const xml = new NfoGenerator().buildXml(
      {
        title: "Sample",
        number: "ABC-123",
        actors: ["Actor A"],
        actor_profiles: [
          {
            name: "Actor A",
            photo_url: "actor-a.jpg",
          },
        ],
        content_type: "VR",
        publisher: "PRESTIGE",
        plot: "Original plot & details",
        plot_zh: "中文简介",
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      {
        videoMeta: {
          durationSeconds: 5400,
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
        },
        buildTags: buildMovieTags,
      },
    );

    const parsed = parseNfoSnapshot(xml).crawlerData;
    expect(parsed.actor_profiles?.[0]).toMatchObject({
      name: "Actor A",
      photo_url: "actor-a.jpg",
    });
    expect(parsed.publisher).toBe("PRESTIGE");
    expect(parsed.content_type).toBe("VR");
    expect(parsed.durationSeconds).toBe(5400);
    expect(parsed.plot).toBe("Original plot & details");
    expect(parsed.plot_zh).toBe("中文简介");
  });

  it("uses outline as the plot fallback", () => {
    const xml = `
      <movie>
        <title>Only Outline</title>
        <uniqueid type="${Website.JAVDB}">ABC-999</uniqueid>
        <outline>概要内容</outline>
      </movie>
    `;

    const result = parseNfoSnapshot(xml).crawlerData;

    expect(result.plot).toBe("概要内容");
    expect(result.plot_zh).toBe("概要内容");
  });

  it("reads release_date from the NFO", () => {
    const xml = `
      <movie>
        <title>Release Date</title>
        <uniqueid type="${Website.DMM}">ABC-2024</uniqueid>
        <releasedate>2024-01-02</releasedate>
      </movie>
    `;

    expect(parseNfoSnapshot(xml).crawlerData.release_date).toBe("2024-01-02");
  });

  it("ignores legacy extra fanart thumbs instead of restoring them as sample images", () => {
    const xml = `
      <movie>
        <title>Legacy Fanart</title>
        <uniqueid type="${Website.DMM}">ABC-555</uniqueid>
        <fanart>
          <thumb>fanart.jpg</thumb>
          <thumb>https://example.com/scene-001.jpg</thumb>
          <thumb>https://example.com/scene-002.jpg</thumb>
        </fanart>
      </movie>
    `;

    const result = parseNfoSnapshot(xml).crawlerData;

    expect(result.fanart_url).toBe("fanart.jpg");
    expect(result.scene_images).toEqual([]);
  });

  it("round-trips local uncensored choice and custom tags through localState", () => {
    const xml = new NfoGenerator().buildXml(
      {
        title: "Local Tags",
        number: "ABC-321",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      {
        localState: {
          uncensoredChoice: "leak",
          tags: ["中文字幕", "自定义标签"],
        },
        buildTags: buildMovieTags,
      },
    );

    const parsed = parseNfoSnapshot(xml);

    expect(parsed.localState).toEqual({
      uncensoredChoice: "leak",
      tags: ["中文字幕", "自定义标签"],
    });
  });

  it("does not restore mirrored genre tags as localState tags", () => {
    const xml = new NfoGenerator().buildXml(
      {
        title: "Genre Mirror",
        number: "ABC-654",
        actors: [],
        genres: ["Drama", "Mystery"],
        scene_images: [],
        website: Website.DMM,
      },
      {
        localState: {
          tags: ["自定义标签"],
        },
        buildTags: buildMovieTags,
      },
    );

    const parsed = parseNfoSnapshot(xml);

    expect(parsed.crawlerData.genres).toEqual(["Drama", "Mystery"]);
    expect(parsed.localState).toEqual({
      tags: ["自定义标签"],
    });
  });

  it("emits poster/thumb/fanart/trailer rows in the aggregation source comment", () => {
    const xml = new NfoGenerator().buildXml(
      {
        title: "Source Comment",
        number: "ABC-001",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
        thumb_url: "https://example.com/thumb.jpg",
        poster_url: "https://example.com/poster.jpg",
        fanart_url: "https://example.com/fanart.jpg",
        trailer_url: "https://example.com/trailer.mp4",
      },
      {
        sources: {
          title: Website.JAVDB,
          thumb_url: Website.JAVBUS,
          poster_url: Website.DMM,
          fanart_url: Website.R18_DEV,
          trailer_url: Website.DMM_TV,
        },
      },
    );

    expect(xml).toContain("poster_url: dmm");
    expect(xml).toContain("thumb_url: javbus");
    expect(xml).toContain("fanart_url: r18_dev");
    expect(xml).toContain("trailer_url: dmm_tv");
  });
});
