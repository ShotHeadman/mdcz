import type { AmbiguousCandidate } from "@mdcz/shared/pending";
import type { FailureReason } from "@mdcz/shared/siteResults";
import { isAbortError } from "../scrape/utils/abort";

export class SiteError extends Error {
  override readonly name = "SiteError";

  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly options: {
      httpStatus?: number;
      retryAfterMs?: number;
      cause?: unknown;
      /** The works an `ambiguous` search listed. */
      candidates?: AmbiguousCandidate[];
    } = {},
  ) {
    super(message, { cause: options.cause });
  }
}

const REGION_PATTERNS = [
  /not[- ]available[- ]in[- ]your[- ]region/iu,
  /お住まいの地域からは?ご利用になれません/u,
  /access from your region is not available/iu,
];

// CloudFront and XSERVER (host of several label sites) answer geo restrictions and WAF blocks with one page;
// either way the block holds for the whole network.
const HOST_BLOCK_PATTERNS = [
  /The request could not be satisfied[\s\S]*Request blocked/iu,
  /<title>403 Forbidden<\/title>[\s\S]*Copyright XSERVER Inc\./iu,
];

const IMPIT_TIMEOUT_ERRORS = new Set(["TimeoutError", "ConnectTimeout", "ReadTimeout", "WriteTimeout", "PoolTimeout"]);

/** Recognizes pages that answer for the network instead of the requested resource. */
export const classifyBlockedPage = (url: string, body: string): FailureReason | null => {
  if (REGION_PATTERNS.some((pattern) => pattern.test(url) || pattern.test(body))) return "region_blocked";
  if (HOST_BLOCK_PATTERNS.some((pattern) => pattern.test(body))) return "region_blocked";
  // Challenge pages also carry a Ray ID, so the challenge check must precede the block check.
  const lowered = body.toLowerCase();
  if (lowered.includes("_cf_chl_opt") || (lowered.includes("just a moment") && lowered.includes("cloudflare"))) {
    return "cloudflare";
  }
  if (lowered.includes("ray id") && lowered.includes("cf-error")) return "cloudflare";
  return null;
};

export const failureReasonForStatus = (status: number): FailureReason => {
  if (status === 404 || status === 410) return "not_found";
  if (status === 429) return "rate_limited";
  return "http_error";
};

export const toTransportSiteError = (error: unknown, url: string): unknown => {
  if (isAbortError(error) || error instanceof SiteError || !(error instanceof Error)) return error;
  const reason = IMPIT_TIMEOUT_ERRORS.has(error.name) ? "timeout" : "network_error";
  return new SiteError(reason, `${error.message} (${url})`, { cause: error });
};

export const findSiteError = (error: unknown): SiteError | undefined => {
  const visited = new Set<unknown>();
  for (let current = error; current instanceof Error && !visited.has(current); current = current.cause) {
    if (current instanceof SiteError) return current;
    visited.add(current);
  }
  return undefined;
};

export const failureReasonOf = (error: unknown): FailureReason => findSiteError(error)?.reason ?? "unknown";
