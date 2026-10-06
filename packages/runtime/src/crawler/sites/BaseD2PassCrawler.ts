import { SiteError } from "@mdcz/runtime/network";
import type { Website } from "@mdcz/shared/enums";
import { toCrawlerErrorResult } from "../base/BaseCrawler";
import { verifyMovieNumber } from "../base/identity";
import { parseDate } from "../base/parser";
import type { AdapterDependencies, CrawlerInput, CrawlerResponse, SiteAdapter } from "../base/types";

interface MovieDetails {
  MovieID: string;
  Title: string;
  Status?: boolean;
  ActressesJa?: string[];
  ActressesEn?: string[];
  UCNAME?: string[];
  Desc?: string;
  Release?: string;
  Duration?: number;
  Series?: string;
  ThumbHigh?: string;
  MovieThumb?: string;
  SampleFiles?: Array<{ URL: string }>;
}

export abstract class BaseD2PassCrawler implements SiteAdapter {
  protected abstract readonly domain: string;
  protected abstract readonly prefix: string;
  protected abstract readonly studio: string;
  abstract site(): Website;
  constructor(private readonly dependencies: AdapterDependencies) {}

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    try {
      const id = input.options?.detailUrl
        ? new URL(input.options.detailUrl).pathname.match(/\/moviepages\/(\d{6})_(\d{2,3})\//u)
        : input.number.match(/(\d{6})[-_](\d{2,3})$/u);
      if (!id) throw new SiteError("not_found", `Unsupported movie number: ${input.number}`);
      const data = await this.dependencies.gateway.fetchJson<MovieDetails>(
        `https://${this.domain}/dyn/phpauto/movie_details/movie_id/${id[1]}_${id[2]}.json`,
        { timeout: input.options?.timeoutMs, signal: input.options?.signal },
      );
      const number = typeof data.MovieID === "string" ? `${this.prefix}-${data.MovieID}` : "";
      verifyMovieNumber(number, input.number);
      if (data.Status === false) throw new SiteError("not_found", `Movie unavailable: ${number}`);
      if (!data.Title?.trim()) throw new SiteError("parse_error", `Movie title missing: ${number}`);
      return {
        input,
        elapsedMs: Date.now() - startedAt,
        result: {
          success: true,
          data: {
            number,
            title: data.Title.trim(),
            actors: (data.ActressesJa?.length ? data.ActressesJa : (data.ActressesEn ?? []))
              .map((name) => name.trim())
              .filter(Boolean),
            genres: data.UCNAME ?? [],
            studio: this.studio,
            publisher: this.studio,
            plot: data.Desc,
            release_date: parseDate(data.Release),
            durationSeconds: data.Duration,
            series: data.Series || undefined,
            thumb_url: data.ThumbHigh ?? data.MovieThumb,
            scene_images: [],
            trailer_url: data.SampleFiles?.at(-1)?.URL,
            website: this.site(),
          },
        },
      };
    } catch (error) {
      return { input, elapsedMs: Date.now() - startedAt, result: toCrawlerErrorResult(error) };
    }
  }
}
