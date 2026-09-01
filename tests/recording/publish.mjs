#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadCrawlerRecordingPlan } from "../../packages/runtime/src/network/crawlerRecordingPlan.ts";
import {
  observationsFromStagedCassettes,
  publishCrawlerRecordingStaging,
} from "../../packages/runtime/src/network/crawlerRecordingPublish.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const planIndex = args.indexOf("--plan");
const planPath = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_PLAN?.trim() ||
    (planIndex >= 0 ? (args[planIndex + 1] ?? "") : "tests/recording/plans/representative-batch.json"),
);
const stagingRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_STAGING?.trim() || "test-results/recording/staging",
);
const publishRoot = path.resolve(workspaceRoot, process.env.MDCZ_RECORD_PUBLISH?.trim() || "tests/fixtures/crawler");

const plan = loadCrawlerRecordingPlan(planPath);
const observations = await observationsFromStagedCassettes(stagingRoot, plan);
await publishCrawlerRecordingStaging({ stagingRoot, publishRoot, plan, observations });
console.log(`Published ${observations.length} crawler cassette(s) to ${publishRoot}`);
