import { asc, eq, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { type SiteResultRow, siteResults } from "./schema";

export interface SiteResultInput {
  site: string;
  status: SiteResultRow["status"];
  reason?: string;
  skipReason?: string;
  detail?: string;
  httpStatus?: number;
  elapsedMs: number;
  /** The site's normalized metadata in its source language, present on success. */
  data?: unknown;
  /** The detail page the data came from, recorded only when a manual URL chose it rather than a number search. */
  sourceUrl?: string;
}

export interface SiteResultRecord extends Omit<SiteResultInput, "data"> {
  number: string;
  data?: unknown;
  updatedAt: Date;
}

const normalizeNumber = (number: string): string => number.trim().toUpperCase();

export class SiteResultRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  /**
   * Keeps the latest outcome per site; stored metadata survives network failures and skips but not a "not found".
   * An ambiguous outcome means no stored answer for the number can be attributed to one work, so it clears them all.
   */
  record(number: string, results: readonly SiteResultInput[], now = new Date()): void {
    const key = normalizeNumber(number);
    this.database.sqlite.transaction(() => {
      if (results.some((result) => result.reason === "ambiguous")) {
        this.database.db
          .update(siteResults)
          .set({ dataJson: null, sourceUrl: null })
          .where(eq(siteResults.number, key))
          .run();
      }
      for (const result of results) {
        this.database.db
          .insert(siteResults)
          .values({
            number: key,
            site: result.site,
            status: result.status,
            reason: result.reason ?? null,
            skipReason: result.skipReason ?? null,
            detail: result.detail ?? null,
            httpStatus: result.httpStatus ?? null,
            elapsedMs: Math.max(0, Math.round(result.elapsedMs)),
            dataJson: result.data === undefined ? null : JSON.stringify(result.data),
            sourceUrl: result.status === "success" ? (result.sourceUrl ?? null) : null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [siteResults.number, siteResults.site],
            set: {
              status: sql`excluded.status`,
              reason: sql`excluded.reason`,
              skipReason: sql`excluded.skip_reason`,
              detail: sql`excluded.detail`,
              httpStatus: sql`excluded.http_status`,
              elapsedMs: sql`excluded.elapsed_ms`,
              dataJson: sql`case when excluded.status = 'success' then excluded.data_json when excluded.reason = 'not_found' then null else ${siteResults.dataJson} end`,
              sourceUrl: sql`case when excluded.status = 'success' then excluded.source_url when excluded.reason = 'not_found' then null else ${siteResults.sourceUrl} end`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .run();
      }
    })();
  }

  list(number: string): SiteResultRecord[] {
    return this.database.db
      .select()
      .from(siteResults)
      .where(eq(siteResults.number, normalizeNumber(number)))
      .orderBy(asc(siteResults.site))
      .all()
      .map((row) => ({
        number: row.number,
        site: row.site,
        status: row.status,
        reason: row.reason ?? undefined,
        skipReason: row.skipReason ?? undefined,
        detail: row.detail ?? undefined,
        httpStatus: row.httpStatus ?? undefined,
        elapsedMs: row.elapsedMs,
        data: row.dataJson === null ? undefined : JSON.parse(row.dataJson),
        sourceUrl: row.sourceUrl ?? undefined,
        updatedAt: row.updatedAt,
      }));
  }
}
