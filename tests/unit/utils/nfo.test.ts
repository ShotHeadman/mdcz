import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfo, parseNfoSnapshot } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

describe("parseNfo", () => {
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

    const result = parseNfo(xml);

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

    const result = parseNfo(xml);

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

    const result = parseNfo(xml);

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

  it("round-trips standard actor nodes, managed movie tags, and streamdetails", () => {
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
        plot: "简短简介",
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      {
        videoMeta: {
          durationSeconds: 5400,
          width: 1920,
          height: 1080,
          codec: "h264",
          bitrate: 8_000_000,
        },
      },
    );

    const parsed = parseNfo(xml);
    expect(parsed.actor_profiles?.[0]).toMatchObject({
      name: "Actor A",
      photo_url: "actor-a.jpg",
    });
    expect(parsed.publisher).toBe("PRESTIGE");
    expect(parsed.content_type).toBe("VR");
    expect(parsed.durationSeconds).toBe(5400);
    expect(parsed.plot).toBe("简短简介");
  });

  it("reads native publisher nodes", () => {
    const xml = `
      <movie>
        <title>Native Publisher</title>
        <uniqueid type="${Website.DMM}">ABC-777</uniqueid>
        <publisher>Native Publisher</publisher>
      </movie>
    `;

    const result = parseNfo(xml);

    expect(result.publisher).toBe("Native Publisher");
  });

  it("uses outline as the plot fallback", () => {
    const xml = `
      <movie>
        <title>Only Outline</title>
        <uniqueid type="${Website.JAVDB}">ABC-999</uniqueid>
        <outline>概要内容</outline>
      </movie>
    `;

    const result = parseNfo(xml);

    expect(result.plot).toBe("概要内容");
    expect(result.plot_zh).toBe("概要内容");
  });

  it("ignores legacy standalone year data and only keeps release_date", () => {
    const withReleaseDateXml = `
      <movie>
        <title>Release Date Wins</title>
        <uniqueid type="${Website.DMM}">ABC-2024</uniqueid>
        <premiered>2024-01-02</premiered>
        <releasedate>2024-01-02</releasedate>
        <year>1999</year>
      </movie>
    `;
    const yearOnlyXml = `
      <movie>
        <title>Year Only</title>
        <uniqueid type="${Website.DMM}">ABC-2001</uniqueid>
        <year>2001</year>
      </movie>
    `;

    const withReleaseDate = parseNfo(withReleaseDateXml);
    const yearOnly = parseNfo(yearOnlyXml);

    expect(withReleaseDate.release_date).toBe("2024-01-02");
    expect(withReleaseDate).not.toHaveProperty("release_year");
    expect(yearOnly.release_date).toBeUndefined();
    expect(yearOnly).not.toHaveProperty("release_year");
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

    const result = parseNfo(xml);

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
      },
    );

    const parsed = parseNfoSnapshot(xml);

    expect(parsed.crawlerData.genres).toEqual(["Drama", "Mystery"]);
    expect(parsed.localState).toEqual({
      tags: ["自定义标签"],
    });
  });
});
