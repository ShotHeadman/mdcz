import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { toErrorMessage } from "@main/utils/common";
import { validateImage } from "@main/utils/image";
import { resolveLocalAssetReference, uniqueDefinedPaths } from "@main/utils/localAssetReferences";
import { parseNfo } from "@main/utils/nfo";
import { buildMovieAssetFileNames, isMovieNfoBaseName, MOVIE_NFO_BASE_NAME } from "@mdcz/shared/assetNaming";
import { Website } from "@mdcz/shared/enums";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/ipcTypes";
import type { CrawlerData } from "@mdcz/shared/types";

const POSTER_FILE_NAME = "poster.jpg";

const buildPosterCandidatePaths = (
  directory: string,
  nfoPath: string,
  parsed: CrawlerData,
  options: { allowFixedPosterFallback: boolean },
): string[] => {
  const nfoBaseName = basename(nfoPath, extname(nfoPath));
  return uniqueDefinedPaths([
    resolveLocalAssetReference(directory, parsed.poster_url),
    options.allowFixedPosterFallback ? join(directory, POSTER_FILE_NAME) : undefined,
    nfoBaseName && !isMovieNfoBaseName(nfoBaseName)
      ? join(directory, buildMovieAssetFileNames(nfoBaseName, "followVideo").poster)
      : undefined,
  ]);
};

export class AmazonPosterToolService {
  private readonly logger = loggerService.getLogger("AmazonPosterToolService");

  constructor(
    private readonly networkClient: NetworkClient,
    private readonly amazonJpImageService: AmazonJpImageService,
  ) {}

  async scan(rootDirectory: string): Promise<AmazonPosterScanItem[]> {
    const normalizedRoot = resolve(rootDirectory.trim());
    const rootStats = await stat(normalizedRoot);
    if (!rootStats.isDirectory()) {
      throw new Error(`Directory not found: ${normalizedRoot}`);
    }

    const nfoPaths = await this.listNfoFiles(normalizedRoot);
    const directoryNamedNfoCounts = new Map<string, number>();
    for (const nfoPath of nfoPaths) {
      const directory = dirname(nfoPath);
      const nfoBaseName = basename(nfoPath, extname(nfoPath)).toLowerCase();
      if (nfoBaseName === MOVIE_NFO_BASE_NAME) {
        continue;
      }

      directoryNamedNfoCounts.set(directory, (directoryNamedNfoCounts.get(directory) ?? 0) + 1);
    }
    const items: AmazonPosterScanItem[] = [];

    for (const nfoPath of nfoPaths) {
      try {
        const xml = await readFile(nfoPath, "utf8");
        const parsed = parseNfo(xml);
        const directory = dirname(nfoPath);
        const allowFixedPosterFallback = (directoryNamedNfoCounts.get(directory) ?? 0) <= 1;
        const currentPosterPath = await this.findCurrentPosterPath(
          directory,
          nfoPath,
          parsed,
          allowFixedPosterFallback,
        );

        let currentPosterWidth = 0;
        let currentPosterHeight = 0;
        let currentPosterSize = 0;

        if (currentPosterPath) {
          try {
            const posterStats = await stat(currentPosterPath);
            if (posterStats.isFile()) {
              currentPosterSize = posterStats.size;

              try {
                const validation = await validateImage(currentPosterPath);
                if (validation.valid) {
                  currentPosterWidth = validation.width;
                  currentPosterHeight = validation.height;
                }
              } catch (error) {
                this.logger.warn(`Failed to inspect poster image '${currentPosterPath}': ${toErrorMessage(error)}`);
              }
            }
          } catch {
            // Poster disappeared during scan; ignore and report as missing.
          }
        }

        items.push({
          nfoPath,
          directory,
          title: parsed.title,
          number: parsed.number,
          currentPosterPath,
          currentPosterWidth,
          currentPosterHeight,
          currentPosterSize,
        });
      } catch (error) {
        this.logger.warn(`Skipping unreadable NFO '${nfoPath}': ${toErrorMessage(error)}`);
      }
    }

    return items.sort((left, right) => left.nfoPath.localeCompare(right.nfoPath, "zh-CN"));
  }

  async lookup(nfoPath: string, title: string): Promise<AmazonPosterLookupResult> {
    const normalizedNfoPath = resolve(nfoPath.trim());
    const normalizedTitle = title.trim();
    const startedAt = Date.now();

    const lookupData: CrawlerData = {
      title: normalizedTitle,
      number: basename(normalizedNfoPath, extname(normalizedNfoPath)),
      actors: [],
      genres: [],
      scene_images: [],
      website: Website.JAVDB,
      poster_url: "lookup",
    };

    try {
      const result = await this.amazonJpImageService.enhance(lookupData);
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
        reason: `查询失败: ${toErrorMessage(error)}`,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  async apply(items: Array<{ nfoPath: string; amazonPosterUrl: string }>): Promise<AmazonPosterApplyResultItem[]> {
    const results: AmazonPosterApplyResultItem[] = [];

    for (const item of items) {
      const normalizedNfoPath = resolve(item.nfoPath.trim());
      const amazonPosterUrl = item.amazonPosterUrl.trim();
      const directory = dirname(normalizedNfoPath);

      let savedPosterPath = join(directory, POSTER_FILE_NAME);
      let replacedExisting = false;

      try {
        if (!item.nfoPath.trim()) {
          throw new Error("NFO path is required");
        }
        if (!amazonPosterUrl) {
          throw new Error("Amazon poster URL is required");
        }

        const directoryStats = await stat(directory);
        if (!directoryStats.isDirectory()) {
          throw new Error(`Directory not found: ${directory}`);
        }

        let parsedNfo: CrawlerData | undefined;
        try {
          parsedNfo = parseNfo(await readFile(normalizedNfoPath, "utf8"));
        } catch (error) {
          this.logger.warn(`Failed to parse NFO '${normalizedNfoPath}' before poster apply: ${toErrorMessage(error)}`);
        }

        const allowFixedPosterFallback = (await this.countNamedNfoFiles(directory)) <= 1;
        savedPosterPath = this.resolvePosterTargetPath(
          directory,
          normalizedNfoPath,
          parsedNfo,
          allowFixedPosterFallback,
        );
        replacedExisting = await this.pathExists(savedPosterPath);

        const tempPosterPath = join(directory, `.amazon-poster-${randomUUID()}.jpg`);

        try {
          await this.networkClient.download(amazonPosterUrl, tempPosterPath);

          const validation = await validateImage(tempPosterPath);
          if (!validation.valid) {
            throw new Error(`Image validation failed: ${validation.reason ?? "parse_failed"}`);
          }

          if (replacedExisting) {
            await unlink(savedPosterPath).catch(() => undefined);
          }

          await rename(tempPosterPath, savedPosterPath);
          const savedStats = await stat(savedPosterPath);

          results.push({
            directory,
            success: true,
            savedPosterPath,
            replacedExisting,
            fileSize: savedStats.size,
          });
        } catch (error) {
          await unlink(tempPosterPath).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        results.push({
          directory,
          success: false,
          savedPosterPath,
          replacedExisting,
          fileSize: 0,
          error: toErrorMessage(error),
        });
      }
    }

    return results;
  }

  private async findCurrentPosterPath(
    directory: string,
    nfoPath: string,
    parsed: CrawlerData,
    allowFixedPosterFallback: boolean,
  ): Promise<string | null> {
    for (const candidatePath of buildPosterCandidatePaths(directory, nfoPath, parsed, { allowFixedPosterFallback })) {
      try {
        const info = await stat(candidatePath);
        if (info.isFile()) {
          return candidatePath;
        }
      } catch {
        // Try the next candidate.
      }
    }

    return null;
  }

  private resolvePosterTargetPath(
    directory: string,
    nfoPath: string,
    parsedNfo: CrawlerData | undefined,
    allowFixedPosterFallback: boolean,
  ): string {
    const candidates = buildPosterCandidatePaths(
      directory,
      nfoPath,
      parsedNfo ?? {
        title: "",
        number: "",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.JAVDB,
      },
      { allowFixedPosterFallback },
    );

    return candidates[0] ?? join(directory, POSTER_FILE_NAME);
  }

  private async listNfoFiles(rootDirectory: string): Promise<string[]> {
    const outputs: string[] = [];
    const stack: string[] = [rootDirectory];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

      for (const entry of entries) {
        const entryPath = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        if (entry.isFile() && extname(entry.name).toLowerCase() === ".nfo") {
          outputs.push(entryPath);
        }
      }
    }

    return outputs;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async countNamedNfoFiles(directory: string): Promise<number> {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries.reduce((count, entry) => {
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".nfo") {
        return count;
      }

      return basename(entry.name, extname(entry.name)).toLowerCase() === MOVIE_NFO_BASE_NAME ? count : count + 1;
    }, 0);
  }
}
