#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateMediaFiles } from "./fixture-files.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_MEDIA_PUBLISH?.trim() || "tests/fixtures/media",
);
const blobRoot = path.resolve(workspaceRoot, process.env.MDCZ_RECORD_MEDIA_BLOBS?.trim() || "tests/fixtures/media");

const manifests = await validateMediaFiles(manifestRoot, blobRoot);
console.log(`Verified ${manifests.length} media fixture case(s) in ${manifestRoot}`);
