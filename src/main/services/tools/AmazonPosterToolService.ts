import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { validateImage } from "@main/utils/image";
import { parseNfo } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import type { AmazonPosterApplyResultItem, AmazonPosterLookupResult, AmazonPosterScanItem } from "@shared/ipcTypes";
import type { CrawlerData } from "@shared/types";

const POSTER_FILE_NAME = "poster.jpg";

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
    const items: AmazonPosterScanItem[] = [];

    for (const nfoPath of nfoPaths) {
      try {
        const xml = await readFile(nfoPath, "utf8");
        const parsed = parseNfo(xml);
        const directory = dirname(nfoPath);
        const posterPath = join(directory, POSTER_FILE_NAME);

        let currentPosterPath: string | null = null;
        let currentPosterWidth = 0;
        let currentPosterHeight = 0;
        let currentPosterSize = 0;

        try {
          const posterStats = await stat(posterPath);
          if (posterStats.isFile()) {
            currentPosterPath = posterPath;
            currentPosterSize = posterStats.size;

            try {
              const validation = await validateImage(posterPath);
              if (validation.valid) {
                currentPosterWidth = validation.width;
                currentPosterHeight = validation.height;
              }
            } catch (error) {
              this.logger.warn(`Failed to inspect poster image '${posterPath}': ${toErrorMessage(error)}`);
            }
          }
        } catch {
          // No poster image in the directory.
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
      sample_images: [],
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

  async apply(items: Array<{ directory: string; amazonPosterUrl: string }>): Promise<AmazonPosterApplyResultItem[]> {
    const results: AmazonPosterApplyResultItem[] = [];

    for (const item of items) {
      const directoryInput = item.directory?.trim() ?? "";
      const amazonPosterUrl = item.amazonPosterUrl?.trim() ?? "";
      const directory = directoryInput ? resolve(directoryInput) : "";
      const savedPosterPath = directory ? join(directory, POSTER_FILE_NAME) : POSTER_FILE_NAME;
      const replacedExisting = directory ? await this.pathExists(savedPosterPath) : false;

      try {
        if (!directory) {
          throw new Error("Directory is required");
        }
        if (!amazonPosterUrl) {
          throw new Error("Amazon poster URL is required");
        }

        const directoryStats = await stat(directory);
        if (!directoryStats.isDirectory()) {
          throw new Error(`Directory not found: ${directory}`);
        }

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
}
