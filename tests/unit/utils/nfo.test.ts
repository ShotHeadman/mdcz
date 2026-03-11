import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfo } from "@main/utils/nfo";
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
        sample_images: [],
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
});
