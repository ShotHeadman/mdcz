import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assertCrawlerFixturePathSegment } from "./crawlerCassette";

const recordingItemSchema = z.object({
  relativePath: z.string().min(1),
  caseId: z.string().min(1),
});

export const crawlerRecordingPlanSchema = z.object({
  journeyId: z.string().min(1),
  items: z.array(recordingItemSchema).min(1),
});

export type CrawlerRecordingPlan = z.infer<typeof crawlerRecordingPlanSchema>;

const normalizeRelativePath = (relativePath: string): string => relativePath.replaceAll("\\", "/");

export const caseIdForRecordingPath = (plan: CrawlerRecordingPlan, relativePath: string): string | undefined => {
  const normalized = normalizeRelativePath(relativePath);
  const exact = plan.items.find((item) => normalizeRelativePath(item.relativePath) === normalized);
  if (exact) return exact.caseId;

  const base = path.posix.basename(normalized);
  const basenameMatches = plan.items.filter(
    (item) => path.posix.basename(normalizeRelativePath(item.relativePath)) === base,
  );
  if (basenameMatches.length === 1) return basenameMatches[0]?.caseId;
  if (basenameMatches.length > 1) {
    throw new Error(`Recording plan has ambiguous caseId mapping for ${relativePath}`);
  }
  return undefined;
};

export const loadCrawlerRecordingPlan = (planPath: string): CrawlerRecordingPlan => {
  const plan = crawlerRecordingPlanSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
  for (const item of plan.items) {
    assertCrawlerFixturePathSegment("Crawler fixture caseId", item.caseId);
  }
  return plan;
};
