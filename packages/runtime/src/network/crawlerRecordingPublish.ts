import { cp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import {
  type CrawlerCassette,
  crawlerCaseIdFromRelativePath,
  crawlerCassetteSchema,
  loadCrawlerCassette,
  resolveCrawlerCassetteDirectory,
} from "./crawlerCassette";
import type { CrawlerCredentialRedactor } from "./crawlerCredentials";

export interface CrawlerRecordingObservation {
  relativePath: string;
  caseId: string;
  website: Website;
}

const websiteValues = new Set<string>(Object.values(Website));

const listCassetteDirectories = async (
  root: string,
): Promise<Array<{ website: string; caseId: string; directory: string }>> => {
  const entries: Array<{ website: string; caseId: string; directory: string }> = [];
  let websites: string[];
  try {
    websites = await readdir(root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  for (const website of websites) {
    const websiteDir = path.join(root, website);
    const cases = await readdir(websiteDir, { withFileTypes: true });
    for (const entry of cases) {
      if (!entry.isDirectory()) continue;
      entries.push({ website, caseId: entry.name, directory: path.join(websiteDir, entry.name) });
    }
  }
  return entries;
};

const scanForResidualSecrets = async (directory: string, redactor: CrawlerCredentialRedactor): Promise<string[]> => {
  const residual: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
        continue;
      }
      const bytes = await readFile(target);
      if (redactor.containsRealSecret(bytes)) residual.push(path.relative(directory, target));
    }
  };
  await walk(directory);
  return residual;
};

export const validateCrawlerRecordingStaging = async (options: {
  stagingRoot: string;
  observations?: readonly CrawlerRecordingObservation[];
  redactor?: CrawlerCredentialRedactor;
}): Promise<CrawlerCassette[]> => {
  const unmapped = (options.observations ?? []).filter(
    (observation) => crawlerCaseIdFromRelativePath(observation.relativePath) !== observation.caseId,
  );
  if (unmapped.length > 0) {
    throw new Error(
      `Recording caseId does not match the scraped path: ${unmapped.map((item) => item.relativePath).join(", ")}`,
    );
  }

  const expected = new Map<string, CrawlerRecordingObservation>();
  for (const observation of options.observations ?? []) {
    expected.set(`${observation.website}\u0000${observation.caseId}`, observation);
  }

  const staged = await listCassetteDirectories(options.stagingRoot);
  const cassettes: CrawlerCassette[] = [];
  for (const entry of staged) {
    if (!websiteValues.has(entry.website)) {
      throw new Error(`Recording staging contains an unknown website directory: ${entry.website}`);
    }
    const website = entry.website as Website;
    const loaded = await loadCrawlerCassette(options.stagingRoot, website, entry.caseId);
    if (loaded.cassette.website !== website) {
      throw new Error(`Crawler cassette crossed website directories at ${entry.directory}`);
    }
    if (loaded.cassette.interactions.length === 0) {
      throw new Error(`Crawler cassette has no interactions at ${website}/${entry.caseId}`);
    }
    if (options.redactor) {
      const residual = await scanForResidualSecrets(entry.directory, options.redactor);
      if (residual.length > 0) {
        throw new Error(
          `Crawler cassette leaked real credentials at ${website}/${entry.caseId}: ${residual.join(", ")}`,
        );
      }
    }
    expected.delete(`${website}\u0000${entry.caseId}`);
    cassettes.push(crawlerCassetteSchema.parse(loaded.cassette));
  }

  if (expected.size > 0) {
    const missing = [...expected.values()].map((item) => `${item.website}/${item.caseId}`).join(", ");
    throw new Error(`Recording did not write cassettes for observed crawler sources: ${missing}`);
  }

  return cassettes;
};

export const publishCrawlerRecordingStaging = async (options: {
  stagingRoot: string;
  publishRoot: string;
  observations?: readonly CrawlerRecordingObservation[];
  redactor?: CrawlerCredentialRedactor;
}): Promise<void> => {
  const cassettes = await validateCrawlerRecordingStaging(options);
  for (const cassette of cassettes) {
    const source = resolveCrawlerCassetteDirectory(options.stagingRoot, cassette.website, cassette.caseId);
    const destination = resolveCrawlerCassetteDirectory(options.publishRoot, cassette.website, cassette.caseId);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }
};
