import { parseNfo } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

describe("parseNfo", () => {
  it("reads poster, cover, and fanart by aspect", () => {
    const xml = `
      <movie>
        <title>中文标题</title>
        <originaltitle>Original Title</originaltitle>
        <website>${Website.JAVDB}</website>
        <uniqueid type="${Website.JAVDB}">ABC-123</uniqueid>
        <thumb aspect="poster">poster.jpg</thumb>
        <thumb aspect="thumb">cover.jpg</thumb>
        <fanart>
          <thumb>fanart.jpg</thumb>
        </fanart>
      </movie>
    `;

    const result = parseNfo(xml);

    expect(result.title).toBe("Original Title");
    expect(result.title_zh).toBe("中文标题");
    expect(result.cover_url).toBe("cover.jpg");
    expect(result.poster_url).toBe("poster.jpg");
    expect(result.fanart_url).toBe("fanart.jpg");
  });

  it("falls back to the first aspectless thumb as cover", () => {
    const xml = `
      <movie>
        <title>Only Cover</title>
        <website>${Website.JAVBUS}</website>
        <uniqueid type="${Website.JAVBUS}">DEF-456</uniqueid>
        <thumb>https://example.com/cover.jpg</thumb>
      </movie>
    `;

    const result = parseNfo(xml);

    expect(result.cover_url).toBe("https://example.com/cover.jpg");
    expect(result.poster_url).toBeUndefined();
  });
});
