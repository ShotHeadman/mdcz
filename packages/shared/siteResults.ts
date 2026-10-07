import { z } from "zod";
import { Website } from "./enums";

export const FAILURE_REASONS = [
  "region_blocked",
  "login_wall",
  "cloudflare",
  "rate_limited",
  "ip_banned",
  "timeout",
  "empty_shell",
  "not_found",
  /** The search lists different works under the number; a fact about the movie, not the network. */
  "ambiguous",
  "parse_error",
  "http_error",
  "network_error",
  "unknown",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Failures that hold for the current network or credentials rather than for one movie. */
export const UNAVAILABLE_FAILURE_REASONS: ReadonlySet<FailureReason> = new Set([
  "region_blocked",
  "login_wall",
  "cloudflare",
  "ip_banned",
]);

export const SKIP_REASONS = [
  "number_mismatch",
  /** Serves only the fallback content type; tried when every other site misses. */
  "content_type",
  "missing_credential",
  "unavailable",
  "cooldown",
  "early_stop",
  "global_timeout",
  /** Another site listed different works under the number, so the rest were cancelled. */
  "ambiguous",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export const siteResultSchema = z.object({
  site: z.enum(Website),
  status: z.enum(["success", "failed", "skipped"]),
  /** Why the site failed; for `unavailable` and `cooldown` skips, the failure that paused it. */
  reason: z.enum(FAILURE_REASONS).optional(),
  skipReason: z.enum(SKIP_REASONS).optional(),
  detail: z.string().optional(),
  httpStatus: z.int().optional(),
  elapsedMs: z.int().nonnegative(),
});

/** Outcomes that hold for the movie whatever network asked: a site that answers them works. */
export const MOVIE_FACT_FAILURE_REASONS: ReadonlySet<FailureReason> = new Set([
  "not_found",
  "ambiguous",
  "parse_error",
]);

export type SiteResult = z.infer<typeof siteResultSchema>;

export const siteHealthSchema = z.object({
  reason: z.enum(FAILURE_REASONS),
  /** Absent while the site stays unavailable until the network changes or a connectivity check passes. */
  until: z.number().optional(),
});

export type SiteHealth = z.infer<typeof siteHealthSchema>;
