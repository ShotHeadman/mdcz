#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { publishCrawlerRecordingStaging } from "../../packages/runtime/src/network/crawlerRecordingPublish.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stagingRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_STAGING?.trim() || "test-results/recording/staging",
);
const publishRoot = path.resolve(workspaceRoot, process.env.MDCZ_RECORD_PUBLISH?.trim() || "tests/fixtures/crawler");

await publishCrawlerRecordingStaging({ stagingRoot, publishRoot });
console.log(`Published crawler cassettes from ${stagingRoot} to ${publishRoot}`);
