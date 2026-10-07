import type { AmbiguousCandidate } from "@mdcz/shared/pending";
import type { ScrapePendingOutcome } from "@mdcz/shared/types";

/** A scrape failure the pending list can explain and offer a repair for. */
export class ScrapeFailureError extends Error {
  override readonly name = "ScrapeFailureError";

  constructor(
    readonly kind: "no_number" | "not_found" | "ambiguous",
    message: string,
    readonly candidates: AmbiguousCandidate[] = [],
  ) {
    super(message);
  }
}

export const pendingOutcomeOf = (error: unknown, number: string): ScrapePendingOutcome =>
  error instanceof ScrapeFailureError
    ? { kind: error.kind, number: number || undefined, candidates: error.candidates }
    : { kind: "failed", number: number || undefined };
