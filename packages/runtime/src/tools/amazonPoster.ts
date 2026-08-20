import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { buildMovieAssetFileNames, isMovieNfoBaseName, MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";
import { Website } from "@mdcz/shared/enums";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/ipcTypes";
import type { CrawlerData } from "@mdcz/shared/types";
import type { RuntimeDownloadNetworkClient } from "../network";
import { parseNfo } from "../scrape/nfo";
import { type ImageValidation, validateImage } from "../scrape/utils/image";
import type { RuntimeLogger } from "../shared";
import { AmazonJpImageService, type AmazonJpNetworkClient } from "./AmazonJpImageService";

const POSTER_FILE_NAME = "poster.jpg";

const toErrorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const uniqueDefinedPaths = (paths: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
};

const resolveLocalAssetReference = (directory: string, value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized || /^https?:\/\//iu.test(normalized)) return undefined;
  return isAbsolute(normalized) ? normalized : join(directory, normalized);
};

const buildPosterCandidatePaths = (
  directory: string,
  nfoPath: string,
  parsed: CrawlerData,
  allowFixedPosterFallback: boolean,
): string[] => {
  const nfoBaseName = basename(nfoPath, extname(nfoPath));
  return uniqueDefinedPaths([
    resolveLocalAssetReference(directory, parsed.poster_url),
    allowFixedPosterFallback ? join(directory, POSTER_FILE_NAME) : undefined,
    nfoBaseName && !isMovieNfoBaseName(nfoBaseName)
      ? join(directory, buildMovieAssetFileNames(nfoBaseName, "followVideo").poster)
      : undefined,
  ]);
};

const listNfoFiles = async (rootDirectory: string): Promise<string[]> => {
  const outputs: string[] = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".nfo") outputs.push(entryPath);
    }
  }
  return outputs;
};

const countNamedNfoFiles = async (directory: string): Promise<number> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.reduce((count, entry) => {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".nfo") return count;
    return basename(entry.name, extname(entry.name)).toLowerCase() === MOVIE_NFO_BASE_NAME ? count : count + 1;
  }, 0);
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const findCurrentPosterPath = async (
  directory: string,
  nfoPath: string,
  parsed: CrawlerData,
  allowFixedPosterFallback: boolean,
): Promise<string | null> => {
  for (const candidatePath of buildPosterCandidatePaths(directory, nfoPath, parsed, allowFixedPosterFallback)) {
    try {
      if ((await stat(candidatePath)).isFile()) return candidatePath;
    } catch {}
  }
  return null;
};

export interface AmazonPosterEnhanceResult {
  poster_url?: string;
  reason: string;
}

export interface AmazonPosterDependencies {
  validateImage?: (filePath: string) => Promise<ImageValidation>;
  enhanceAmazonPoster?: (data: CrawlerData) => Promise<AmazonPosterEnhanceResult>;
  logger?: Pick<RuntimeLogger, "warn">;
}

const defaultAmazonPosterDependencies: Required<Pick<AmazonPosterDependencies, "validateImage">> = {
  validateImage,
};

export const scanAmazonPosters = async (
  rootDirectory: string,
  dependencies: AmazonPosterDependencies = {},
): Promise<AmazonPosterScanItem[]> => {
  const validateImageFn = dependencies.validateImage ?? defaultAmazonPosterDependencies.validateImage;
  const normalizedRoot = resolve(rootDirectory.trim());
  if (!(await stat(normalizedRoot)).isDirectory()) throw new Error(`Directory not found: ${normalizedRoot}`);
  const nfoPaths = await listNfoFiles(normalizedRoot);
  const directoryNamedNfoCounts = new Map<string, number>();
  for (const nfoPath of nfoPaths) {
    const directory = dirname(nfoPath);
    const nfoBaseName = basename(nfoPath, extname(nfoPath)).toLowerCase();
    if (nfoBaseName !== MOVIE_NFO_BASE_NAME) {
      directoryNamedNfoCounts.set(directory, (directoryNamedNfoCounts.get(directory) ?? 0) + 1);
    }
  }

  const items: AmazonPosterScanItem[] = [];
  for (const nfoPath of nfoPaths) {
    const xml = await readFile(nfoPath, "utf8");
    const parsed = parseNfo(xml, nfoPath);
    const directory = dirname(nfoPath);
    const nfoBaseName = basename(nfoPath, extname(nfoPath)).toLowerCase();
    if (nfoBaseName === MOVIE_NFO_BASE_NAME && (directoryNamedNfoCounts.get(directory) ?? 0) > 0) {
      continue;
    }

    const currentPosterPath = await findCurrentPosterPath(
      directory,
      nfoPath,
      parsed,
      (directoryNamedNfoCounts.get(directory) ?? 0) <= 1,
    );
    let currentPosterWidth = 0;
    let currentPosterHeight = 0;
    let currentPosterSize = 0;
    if (currentPosterPath) {
      const posterStats = await stat(currentPosterPath).catch(() => null);
      if (posterStats?.isFile()) {
        currentPosterSize = posterStats.size;
        const validation = await validateImageFn(currentPosterPath).catch(() => null);
        if (validation?.valid) {
          currentPosterWidth = validation.width;
          currentPosterHeight = validation.height;
        }
      }
    }
    items.push({
      nfoPath,
      directory,
      title: parsed.title,
      searchTitle: parsed.title,
      number: parsed.number,
      currentPosterPath,
      currentPosterWidth,
      currentPosterHeight,
      currentPosterSize,
    });
  }
  return items.sort((left, right) => left.nfoPath.localeCompare(right.nfoPath, "zh-CN"));
};

export const lookupAmazonPoster = async (
  networkClient: AmazonJpNetworkClient,
  nfoPath: string,
  title: string,
  dependencies: AmazonPosterDependencies = {},
): Promise<AmazonPosterLookupResult> => {
  const normalizedNfoPath = resolve(nfoPath.trim());
  const startedAt = Date.now();
  try {
    const data: CrawlerData = {
      title: title.replace(/\s+/gu, " ").trim(),
      number: basename(normalizedNfoPath, extname(normalizedNfoPath)),
      actors: [],
      genres: [],
      scene_images: [],
      website: Website.JAVDB,
      poster_url: "lookup",
    };
    const result = dependencies.enhanceAmazonPoster
      ? await dependencies.enhanceAmazonPoster(data)
      : await new AmazonJpImageService(networkClient, dependencies.logger).enhance(data);
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: result.poster_url ?? null,
      reason: result.reason,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: null,
      reason: `查询失败: ${toErrorText(error)}`,
      elapsedMs: Date.now() - startedAt,
    };
  }
};

export const applyAmazonPosters = async (
  networkClient: RuntimeDownloadNetworkClient,
  items: Array<{ nfoPath: string; amazonPosterUrl: string }>,
  dependencies: AmazonPosterDependencies = {},
): Promise<AmazonPosterApplyResultItem[]> => {
  const validateImageFn = dependencies.validateImage ?? defaultAmazonPosterDependencies.validateImage;
  const results: AmazonPosterApplyResultItem[] = [];
  for (const item of items) {
    const normalizedNfoPath = resolve(item.nfoPath.trim());
    const directory = dirname(normalizedNfoPath);
    let savedPosterPath = join(directory, POSTER_FILE_NAME);
    let replacedExisting = false;
    try {
      const parsedNfo = parseNfo(await readFile(normalizedNfoPath, "utf8"), normalizedNfoPath);
      savedPosterPath =
        buildPosterCandidatePaths(
          directory,
          normalizedNfoPath,
          parsedNfo,
          (await countNamedNfoFiles(directory)) <= 1,
        )[0] ?? savedPosterPath;
      replacedExisting = await pathExists(savedPosterPath);
      const tempPosterPath = join(directory, `.amazon-poster-${randomUUID()}.jpg`);
      try {
        await networkClient.download(item.amazonPosterUrl.trim(), tempPosterPath);
        const validation = await validateImageFn(tempPosterPath);
        if (!validation.valid) throw new Error(`Image validation failed: ${validation.reason ?? "parse_failed"}`);
        if (replacedExisting) await unlink(savedPosterPath).catch(() => undefined);
        await rename(tempPosterPath, savedPosterPath);
      } catch (error) {
        await unlink(tempPosterPath).catch(() => undefined);
        throw error;
      }
      results.push({
        directory,
        success: true,
        savedPosterPath,
        replacedExisting,
        fileSize: (await stat(savedPosterPath)).size,
      });
    } catch (error) {
      results.push({
        directory,
        success: false,
        savedPosterPath,
        replacedExisting,
        fileSize: 0,
        error: toErrorText(error),
      });
    }
  }
  return results;
};
