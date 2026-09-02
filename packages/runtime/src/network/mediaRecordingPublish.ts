import { cp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { CrawlerCredentialRedactor } from "./crawlerCredentials";
import { loadMediaFixture, type MediaFixtureManifest, resolveMediaFixtureDirectory } from "./mediaFixture";

const listCaseIds = async (root: string): Promise<string[]> => {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

export const validateMediaRecordingStaging = async (options: {
  manifestRoot: string;
  blobRoot: string;
  expectedCaseIds?: readonly string[];
  redactor?: CrawlerCredentialRedactor;
}): Promise<MediaFixtureManifest[]> => {
  const expected = new Set(options.expectedCaseIds ?? []);
  const manifests: MediaFixtureManifest[] = [];
  for (const caseId of await listCaseIds(options.manifestRoot)) {
    const loaded = await loadMediaFixture(options.manifestRoot, options.blobRoot, caseId);
    if (loaded.manifest.interactions.length === 0) {
      throw new Error(`Media fixture has no interactions at ${caseId}`);
    }
    if (options.redactor) {
      const manifestBytes = await readFile(
        path.join(resolveMediaFixtureDirectory(options.manifestRoot, caseId), "manifest.json"),
      );
      if (options.redactor.containsRealSecret(manifestBytes)) {
        throw new Error(`Media fixture manifest leaked real credentials at ${caseId}`);
      }
    }
    expected.delete(caseId);
    manifests.push(loaded.manifest);
  }
  if (expected.size > 0) {
    throw new Error(`Recording did not write media manifests for observed cases: ${[...expected].join(", ")}`);
  }
  return manifests;
};

export const publishMediaRecordingStaging = async (options: {
  stagingRoot: string;
  publishRoot: string;
  blobRoot: string;
  expectedCaseIds?: readonly string[];
  redactor?: CrawlerCredentialRedactor;
}): Promise<MediaFixtureManifest[]> => {
  const manifests = await validateMediaRecordingStaging({
    manifestRoot: options.stagingRoot,
    blobRoot: options.blobRoot,
    expectedCaseIds: options.expectedCaseIds,
    redactor: options.redactor,
  });
  for (const manifest of manifests) {
    const source = resolveMediaFixtureDirectory(options.stagingRoot, manifest.caseId);
    const destination = resolveMediaFixtureDirectory(options.publishRoot, manifest.caseId);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }
  return manifests;
};
