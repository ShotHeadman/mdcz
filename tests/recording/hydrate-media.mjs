#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateMediaFiles } from "./fixture-files.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRootValue = process.argv[2]?.trim() || process.env.MDCZ_MEDIA_FIXTURE_SOURCE?.trim();
if (!sourceRootValue) {
  throw new Error("Pass a media artifact directory or set MDCZ_MEDIA_FIXTURE_SOURCE");
}
const sourceRoot = path.resolve(sourceRootValue);
const manifestRoot = path.resolve(
  workspaceRoot,
  process.env.MDCZ_RECORD_MEDIA_PUBLISH?.trim() || "tests/fixtures/media",
);
const blobRoot = path.resolve(workspaceRoot, process.env.MDCZ_RECORD_MEDIA_BLOBS?.trim() || "tests/fixtures/media");
const entries = await readdir(manifestRoot, { withFileTypes: true });
const hashes = new Set();
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(await readFile(path.join(manifestRoot, entry.name, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.caseId !== entry.name || !Array.isArray(manifest.interactions)) {
    throw new Error(`Invalid media manifest at ${entry.name}`);
  }
  for (const interaction of manifest.interactions) {
    if (interaction.response) hashes.add(interaction.response.sha256);
  }
}

await mkdir(path.join(blobRoot, "blobs"), { recursive: true });
for (const hash of hashes) {
  await copyFile(path.join(sourceRoot, "blobs", hash), path.join(blobRoot, "blobs", hash));
}
await validateMediaFiles(manifestRoot, blobRoot);
console.log(`Hydrated ${hashes.size} media blob(s) from ${sourceRoot}`);
