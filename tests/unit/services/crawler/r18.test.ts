import { R18DevCrawler } from "@main/services/crawler/sites/r18";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const LOOKUP_URL = "https://r18.dev/videos/vod/movies/detail/-/dvd_id=URE-013/json";
const COMPACT_LOOKUP_URL = "https://r18.dev/videos/vod/movies/detail/-/dvd_id=ure00013/json";
const COMBINED_URL = "https://r18.dev/videos/vod/movies/detail/-/combined=ure00013/json";

const createDetailPayload = (overrides: Record<string, unknown> = {}) => ({
  content_id: "ure00013",
  dvd_id: "URE-013",
  title_ja: "濃密な日本語タイトル",
  title_en: "Dense English Title",
  comment_ja: "日本語の紹介文",
  comment_en: "English plot text",
  runtime_mins: 121,
  release_date: "2026-04-01",
  maker_name_ja: "日本メーカー",
  maker_name_en: "English Maker",
  label_name_ja: "日本レーベル",
  label_name_en: "English Label",
  series_name_ja: "日本シリーズ",
  series_name_en: "English Series",
  jacket_full_url: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013pl.jpg",
  jacket_thumb_url: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013ps.jpg",
  gallery_full_first: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013jp-1.jpg",
  gallery_full_last: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013jp-3.jpg",
  sample_url: "https://cc3001.dmm.co.jp/sample/ure00013.mp4",
  actresses: [
    {
      name_kanji: "北川美玖",
      name_kana: "きたがわみく",
      name_romaji: "Miku Kitagawa",
    },
  ],
  directors: [
    {
      name_kanji: "山田監督",
      name_romaji: "Director Yamada",
    },
  ],
  categories: [
    {
      name_ja: "巨乳",
      name_en: "Big breasts",
    },
  ],
  ...overrides,
});

const createCrawler = (fixtures: Map<string, unknown>) => {
  const networkClient = new FixtureNetworkClient(fixtures);
  return {
    crawler: new R18DevCrawler(withGateway(networkClient)),
    networkClient,
  };
};

describe("R18DevCrawler", () => {
  it("resolves an exact DVD code, fetches combined detail JSON, and maps Japanese metadata by default", async () => {
    const { crawler, networkClient } = createCrawler(
      new Map<string, unknown>([
        [LOOKUP_URL, { content_id: "ure00013", dvd_id: "URE-013" }],
        [COMBINED_URL, createDetailPayload()],
      ]),
    );

    const response = await crawler.crawl({
      number: "URE-013",
      site: Website.R18_DEV,
      options: { timeoutMs: 15_000 },
    });

    expect(networkClient.requests.map((request) => request.url)).toEqual([LOOKUP_URL, COMBINED_URL]);
    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      website: Website.R18_DEV,
      number: "URE-013",
      title: "濃密な日本語タイトル",
      actors: ["北川美玖"],
      genres: ["巨乳"],
      studio: "日本メーカー",
      director: "山田監督",
      publisher: "日本レーベル",
      series: "日本シリーズ",
      plot: "日本語の紹介文",
      release_date: "2026-04-01",
      durationSeconds: 121 * 60,
      thumb_url: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013pl.jpg",
      poster_url: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013ps.jpg",
      fanart_url: "https://pics.dmm.co.jp/digital/video/ure00013/ure00013pl.jpg",
      trailer_url: "https://cc3001.dmm.co.jp/sample/ure00013.mp4",
      trailer_source_url: "https://cc3001.dmm.co.jp/sample/ure00013.mp4",
    });
    expect(response.result.data.scene_images).toEqual([
      "https://pics.dmm.co.jp/digital/video/ure00013/ure00013jp-1.jpg",
      "https://pics.dmm.co.jp/digital/video/ure00013/ure00013jp-2.jpg",
      "https://pics.dmm.co.jp/digital/video/ure00013/ure00013jp-3.jpg",
    ]);
  });

  it("uses English title, names, and relation fields when the R18 language preference is English", async () => {
    const { crawler } = createCrawler(
      new Map<string, unknown>([
        [LOOKUP_URL, { content_id: "ure00013", dvd_id: "URE-013" }],
        [COMBINED_URL, createDetailPayload()],
      ]),
    );

    const response = await crawler.crawl({
      number: "URE-013",
      site: Website.R18_DEV,
      options: { r18MetadataLanguage: "en" },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      title: "Dense English Title",
      actors: ["Miku Kitagawa"],
      genres: ["Big breasts"],
      studio: "English Maker",
      director: "Director Yamada",
      publisher: "English Label",
      series: "English Series",
      plot: "English plot text",
    });
  });

  it("falls back to Japanese fields when English metadata is missing", async () => {
    const { crawler } = createCrawler(
      new Map<string, unknown>([
        [LOOKUP_URL, { content_id: "ure00013", dvd_id: "URE-013" }],
        [
          COMBINED_URL,
          createDetailPayload({
            title_en: undefined,
            comment_en: undefined,
            maker_name_en: undefined,
            label_name_en: undefined,
            series_name_en: undefined,
            actresses: [{ name_kanji: "北川美玖" }],
            directors: [{ name_kanji: "山田監督" }],
            categories: [{ name_ja: "巨乳" }],
          }),
        ],
      ]),
    );

    const response = await crawler.crawl({
      number: "URE-013",
      site: Website.R18_DEV,
      options: { r18MetadataLanguage: "en" },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      title: "濃密な日本語タイトル",
      actors: ["北川美玖"],
      genres: ["巨乳"],
      studio: "日本メーカー",
      director: "山田監督",
      publisher: "日本レーベル",
      series: "日本シリーズ",
      plot: "日本語の紹介文",
    });
  });

  it("classifies not-found and malformed R18 JSON responses", async () => {
    const notFound = createCrawler(
      new Map<string, unknown>([
        [LOOKUP_URL, { results: [] }],
        [COMPACT_LOOKUP_URL, { results: [] }],
      ]),
    );
    const notFoundResponse = await notFound.crawler.crawl({
      number: "URE-013",
      site: Website.R18_DEV,
    });

    expect(notFoundResponse.result.success).toBe(false);
    if (notFoundResponse.result.success) {
      throw new Error("expected not-found failure");
    }
    expect(notFoundResponse.result.failureReason).toBe("not_found");

    const malformed = createCrawler(
      new Map<string, unknown>([
        [LOOKUP_URL, { content_id: "ure00013", dvd_id: "URE-013" }],
        [COMBINED_URL, { content_id: "ure00013", dvd_id: "URE-013" }],
      ]),
    );
    const malformedResponse = await malformed.crawler.crawl({
      number: "URE-013",
      site: Website.R18_DEV,
    });

    expect(malformedResponse.result.success).toBe(false);
    if (malformedResponse.result.success) {
      throw new Error("expected parse failure");
    }
    expect(malformedResponse.result.failureReason).toBe("parse_error");
  });
});
