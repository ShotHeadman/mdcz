import { z } from "zod";
import { Website } from "./enums";
import { rootFileRefSchema } from "./mediaRef";
import { siteResultSchema } from "./siteResults";

/**
 * Why a file waits for a person:
 * - `no_number`: the file name yields no number.
 * - `not_found`: every site failed or missed.
 * - `ambiguous`: sites list different works under the number; publishing would mix them.
 * - `failed`: any other scrape error.
 * - `uncensored`: published, but whether it is uncensored, cracked or leaked needs a decision.
 * - `new_file`: found by a register-only library and not scraped yet.
 */
export const PENDING_KINDS = ["no_number", "not_found", "ambiguous", "failed", "uncensored", "new_file"] as const;
export type PendingKindDto = (typeof PENDING_KINDS)[number];

export const ambiguousCandidateSchema = z.object({
  site: z.enum(Website),
  detailUrl: z.string(),
  title: z.string(),
  releaseDate: z.string().optional(),
  studio: z.string().optional(),
  coverUrl: z.string().optional(),
});
export type AmbiguousCandidate = z.infer<typeof ambiguousCandidateSchema>;

export const pendingItemSchema = z.object({
  id: z.string(),
  kind: z.enum(PENDING_KINDS),
  ref: rootFileRefSchema,
  path: z.string(),
  fileName: z.string(),
  libraryId: z.string().nullable(),
  libraryName: z.string().nullable(),
  movieId: z.string().nullable(),
  number: z.string().nullable(),
  detail: z.string().nullable(),
  candidates: z.array(ambiguousCandidateSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PendingItemDto = z.infer<typeof pendingItemSchema>;

export const pendingListResponseSchema = z.object({ items: z.array(pendingItemSchema) });
export type PendingListResponse = z.infer<typeof pendingListResponseSchema>;

export const pendingSiteResultSchema = siteResultSchema.extend({ updatedAt: z.string() });
export type PendingSiteResultDto = z.infer<typeof pendingSiteResultSchema>;

export const pendingDetailResponseSchema = z.object({
  item: pendingItemSchema,
  siteResults: z.array(pendingSiteResultSchema),
});
export type PendingDetailResponse = z.infer<typeof pendingDetailResponseSchema>;

export const pendingIdInputSchema = z.object({ id: z.string().trim().min(1) });
export type PendingIdInput = z.infer<typeof pendingIdInputSchema>;

/** A repair learned from one file, so files named the same way parse on their own next time. */
export const pendingRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ignoreToken"), token: z.string().trim().min(1) }),
  z.object({ kind: z.literal("numberMapping"), match: z.string().trim().min(1) }),
]);
export type PendingRule = z.infer<typeof pendingRuleSchema>;

export const pendingRetryInputSchema = z.object({
  id: z.string().trim().min(1),
  /** Scrape into this library instead of the one the file was found for. */
  libraryId: z.string().trim().min(1).optional(),
  number: z.string().trim().min(1).optional(),
  manualUrl: z.string().trim().min(1).optional(),
  /** An ambiguous entry's chosen work, by index into its candidates. */
  candidate: z.number().int().nonnegative().optional(),
  rule: pendingRuleSchema.optional(),
});
export type PendingRetryInput = z.infer<typeof pendingRetryInputSchema>;

export const pendingConfirmUncensoredInputSchema = z.object({
  id: z.string().trim().min(1),
  choice: z.enum(["umr", "leak", "uncensored"]),
});
export type PendingConfirmUncensoredInput = z.infer<typeof pendingConfirmUncensoredInputSchema>;

export const pendingRetryResponseSchema = z.object({ taskId: z.string() });
export type PendingRetryResponse = z.infer<typeof pendingRetryResponseSchema>;
