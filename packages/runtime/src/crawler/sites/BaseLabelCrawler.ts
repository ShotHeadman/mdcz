import { SiteError } from "@mdcz/runtime/network";
import type { Website } from "@mdcz/shared/enums";
import { stripTrailingActorNames } from "@mdcz/shared/titleRepair";
import { load } from "cheerio";
import { toCrawlerErrorResult } from "../base/BaseCrawler";
import { verifyMovieNumber } from "../base/identity";
import { parseDate } from "../base/parser";
import type { AdapterDependencies, CrawlerInput, CrawlerResponse, SiteAdapter } from "../base/types";

interface WorksPost {
  slug: string;
  title?: { rendered?: string };
  acf?: Record<string, string>;
  acf_custom_images?: { main_photo_url?: string; sub_photo_url?: string; gallery_urls?: string[] };
}

export abstract class BaseLabelCrawler implements SiteAdapter {
  protected abstract readonly baseUrl: string;
  protected abstract readonly studio: string;
  abstract site(): Website;

  constructor(private readonly dependencies: AdapterDependencies) {}

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    try {
      const slug = input.options?.detailUrl
        ? (new URL(input.options.detailUrl).pathname.match(/\/works\/([^/]+)/u)?.[1] ?? "")
        : input.number.toLowerCase().replace(/[\s_-]/gu, "");
      // WordPress redirects missing HTML slugs to other works; the REST slug filter is exact.
      const posts = await this.dependencies.gateway.fetchJson<WorksPost[]>(
        `${this.baseUrl}/wp-json/wp/v2/works?slug=${encodeURIComponent(slug)}`,
        { timeout: input.options?.timeoutMs, signal: input.options?.signal, cookies: input.options?.cookies },
      );
      if (!Array.isArray(posts)) throw new SiteError("parse_error", "Expected a WordPress works array");
      const post = posts.find((entry) => entry.slug === slug);
      if (!post) throw new SiteError("not_found", `No exact works slug for ${input.number}`);
      const number = post.slug.replace(/^([a-z]+)(\d+)/u, "$1-$2").toUpperCase();
      verifyMovieNumber(number, input.number);
      const fields = post.acf ?? {};
      const actors = (fields.出演女優 ?? "").split(/[/、\s]+/u).filter(Boolean);
      const title = stripTrailingActorNames(
        load(fields.作品名 || post.title?.rendered || "")
          .text()
          .trim(),
        actors,
      );
      if (!title) throw new SiteError("parse_error", `Missing works title for ${number}`);
      const minutes = Number.parseInt(fields.収録時間 ?? "", 10);
      const images = post.acf_custom_images;
      return {
        input,
        elapsedMs: Date.now() - startedAt,
        result: {
          success: true,
          data: {
            number,
            title,
            actors,
            genres: [],
            studio: this.studio,
            publisher: this.studio,
            plot: fields.作品紹介文 ? load(fields.作品紹介文).text().trim() : undefined,
            release_date: parseDate(fields["発売日（表示用）"]),
            durationSeconds: Number.isFinite(minutes) ? minutes * 60 : undefined,
            thumb_url: images?.main_photo_url,
            poster_url: images?.sub_photo_url,
            scene_images: (images?.gallery_urls ?? []).filter((url) => typeof url === "string" && url.length > 0),
            website: this.site(),
          },
        },
      };
    } catch (error) {
      return { input, elapsedMs: Date.now() - startedAt, result: toCrawlerErrorResult(error) };
    }
  }
}
