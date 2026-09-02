#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  publishDirectories,
  validateCrawlerFiles,
  validateMediaFiles,
  validateRecordingReceipt,
} from "./fixture-files.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stagingRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_STAGING?.trim() || "test-results/recording/staging",
);
const publishRoot = path.resolve(workspaceRoot, process.env.MDCZ_RECORD_PUBLISH?.trim() || "tests/fixtures/crawler");
const mediaStagingRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_MEDIA_STAGING?.trim() || "test-results/recording/media-staging",
);
const mediaPublishRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_MEDIA_PUBLISH?.trim() || "tests/fixtures/media",
);
const mediaBlobRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_MEDIA_BLOBS?.trim() || "tests/fixtures/media",
);
const receiptPath = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_RECEIPT?.trim() || "test-results/recording/validated.json",
);

const [crawlerCassettes, mediaManifests] = await Promise.all([
  validateCrawlerFiles(stagingRoot),
  validateMediaFiles(mediaStagingRoot, mediaBlobRoot),
]);
if (crawlerCassettes.length + mediaManifests.length === 0) {
  throw new Error("Recording staging is empty; nothing was published");
}
await validateRecordingReceipt(receiptPath, stagingRoot, mediaStagingRoot, [
  ...crawlerCassettes.map((entry) => path.posix.join("crawler", entry.website, entry.caseId, "cassette.json")),
  ...mediaManifests.map((entry) => path.posix.join("media", entry.caseId, "manifest.json")),
]);
await publishDirectories(crawlerCassettes, stagingRoot, publishRoot, (entry) => path.join(entry.website, entry.caseId));
await publishDirectories(mediaManifests, mediaStagingRoot, mediaPublishRoot, (entry) => entry.caseId);
console.log(`Published ${crawlerCassettes.length} crawler cassette(s) and ${mediaManifests.length} media manifest(s)`);
