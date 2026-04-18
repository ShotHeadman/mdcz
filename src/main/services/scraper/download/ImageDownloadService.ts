import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { toErrorMessage } from "@main/utils/common";
import {
  getImageFileExtensionForFormat,
  type ImageFileFormat,
  replaceImageFileExtension,
  validateImage,
} from "@main/utils/image";
import { isAbortError, throwIfAborted } from "../abort";
import type { ImageHostCooldownTracker } from "./ImageHostCooldownTracker";

interface DownloadLogger {
  warn(message: string): void;
}

type ImageDownloadSkipReason = "host_cooldown" | "download_failed" | "invalid_image";
type SafeDownloadResult =
  | { status: "downloaded"; path: string }
  | { status: "skipped"; reason: "host_cooldown" | "download_failed" };
export type DownloadValidatedImageResult =
  | { status: "downloaded"; path: string; width: number; height: number; format?: ImageFileFormat }
  | { status: "skipped"; reason: ImageDownloadSkipReason };
export type ProbedImageCandidate = ProbeResult & { index: number; url: string };
type ProbedImageCandidateWithDimensions = ProbedImageCandidate & { width: number; height: number };
type DownloadedImageCandidate = {
  path: string;
  width: number;
  height: number;
  format?: ImageFileFormat;
  rank: number;
};

const IMAGE_PROBE_TERMINAL_MISS_STATUS_CODES = new Set([404, 410]);

const createFailedProbeCandidate = (url: string, index: number): ProbedImageCandidate => ({
  url,
  index,
  ok: false,
  contentLength: null,
  status: 0,
  resolvedUrl: url,
});

export class ImageDownloadService {
  constructor(
    private readonly networkClient: NetworkClient,
    private readonly hostCooldown: ImageHostCooldownTracker,
    private readonly logger: DownloadLogger,
  ) {}

  async downloadBestImage(candidates: string[], outputPath: string, signal?: AbortSignal): Promise<string | undefined> {
    if (candidates.length === 0) {
      return undefined;
    }

    const probedCandidates = await this.orderImageCandidatesByProbe(candidates, signal, true);
    const downloadableCandidates = probedCandidates.filter((candidate) =>
      this.shouldAttemptCandidateDownload(candidate),
    );
    if (downloadableCandidates.length === 0) {
      return undefined;
    }

    if (this.canSelectBestImageFromProbe(downloadableCandidates)) {
      for (const candidate of downloadableCandidates) {
        throwIfAborted(signal);
        const downloaded = await this.downloadValidatedImageCandidate(candidate.url, outputPath, { signal });
        if (downloaded.status === "downloaded") {
          return downloaded.path;
        }
      }

      return undefined;
    }

    return await this.downloadBestImageByComparison(downloadableCandidates, outputPath, signal);
  }

  async downloadValidatedImageCandidate(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; minBytes?: number; signal?: AbortSignal } = {},
  ): Promise<DownloadValidatedImageResult> {
    throwIfAborted(options.signal);
    const downloadResult = await this.downloadFile(url, outputPath, options);
    if (downloadResult.status !== "downloaded") {
      return downloadResult;
    }

    try {
      const validation = await validateImage(downloadResult.path, options.minBytes);
      if (validation.valid) {
        const normalizedPath = await this.normalizeDownloadedImageExtension(downloadResult.path, validation.format);
        return {
          status: "downloaded",
          path: normalizedPath,
          width: validation.width,
          height: validation.height,
          format: validation.format,
        };
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(downloadResult.path).catch(() => undefined);
    return { status: "skipped", reason: "invalid_image" };
  }

  async copyDerivedImage(sourcePath: string, targetPath: string, targetLabel: string): Promise<string | null> {
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      return targetPath;
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to derive ${targetLabel} image: ${message}`);
      return null;
    }
  }

  async downloadFile(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SafeDownloadResult> {
    throwIfAborted(options.signal);
    if (this.hostCooldown.shouldSkipUrl(url)) {
      return { status: "skipped", reason: "host_cooldown" };
    }

    try {
      const downloadedPath = await this.networkClient.download(url, outputPath, {
        timeout: options.timeoutMs,
        signal: options.signal,
      });
      this.hostCooldown.reset(url);
      return { status: "downloaded", path: downloadedPath };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      this.hostCooldown.recordFailure(url, message);
      this.logger.warn(`Download failed for ${url}: ${message}`);
      return { status: "skipped", reason: "download_failed" };
    }
  }

  private async downloadBestImageByComparison(
    candidates: ProbedImageCandidate[],
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    let bestCandidate: DownloadedImageCandidate | null = null;
    const tempPaths = new Set<string>();

    try {
      for (const [rank, candidate] of candidates.entries()) {
        throwIfAborted(signal);
        if (bestCandidate && this.canSkipCandidateDownload(candidate, bestCandidate)) {
          continue;
        }

        const tempPath = `${outputPath}.candidate-${rank + 1}.part`;
        const downloaded = await this.downloadValidatedImageCandidate(candidate.url, tempPath, { signal });
        if (downloaded.status !== "downloaded") {
          continue;
        }

        tempPaths.add(downloaded.path);
        const downloadedCandidate: DownloadedImageCandidate = {
          path: downloaded.path,
          width: downloaded.width,
          height: downloaded.height,
          format: downloaded.format,
          rank,
        };

        if (!bestCandidate || this.isHigherResolutionCandidate(downloadedCandidate, bestCandidate)) {
          if (bestCandidate) {
            await unlink(bestCandidate.path).catch(() => undefined);
            tempPaths.delete(bestCandidate.path);
          }
          bestCandidate = downloadedCandidate;
          continue;
        }

        await unlink(downloadedCandidate.path).catch(() => undefined);
        tempPaths.delete(downloadedCandidate.path);
      }

      if (!bestCandidate) {
        return undefined;
      }

      throwIfAborted(signal);
      const finalPath = this.resolveImageOutputPath(outputPath, bestCandidate.format);
      await unlink(outputPath).catch(() => undefined);
      if (finalPath !== outputPath) {
        await unlink(finalPath).catch(() => undefined);
      }
      await rename(bestCandidate.path, finalPath);
      tempPaths.delete(bestCandidate.path);
      return finalPath;
    } finally {
      for (const tempPath of tempPaths) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  private resolveImageOutputPath(outputPath: string, format: ImageFileFormat | undefined): string {
    const extension = getImageFileExtensionForFormat(format);
    return extension ? replaceImageFileExtension(outputPath, extension) : outputPath;
  }

  private async normalizeDownloadedImageExtension(
    filePath: string,
    format: ImageFileFormat | undefined,
  ): Promise<string> {
    const normalizedPath = this.resolveImageOutputPath(filePath, format);
    if (normalizedPath === filePath) {
      return filePath;
    }

    await unlink(normalizedPath).catch(() => undefined);
    await rename(filePath, normalizedPath);
    return normalizedPath;
  }

  private isHigherResolutionCandidate(
    candidate: DownloadedImageCandidate,
    currentBest: DownloadedImageCandidate,
  ): boolean {
    const resolutionComparison = this.compareImageResolution(candidate, currentBest);
    return resolutionComparison < 0 || (resolutionComparison === 0 && candidate.rank < currentBest.rank);
  }

  private canSkipCandidateDownload(candidate: ProbedImageCandidate, currentBest: DownloadedImageCandidate): boolean {
    return this.hasProbeDimensions(candidate) && this.compareImageResolution(candidate, currentBest) >= 0;
  }

  private shouldAttemptCandidateDownload(candidate: ProbedImageCandidate): boolean {
    return !(candidate.status > 0 && IMAGE_PROBE_TERMINAL_MISS_STATUS_CODES.has(candidate.status));
  }

  private hasProbeDimensions(candidate: ProbedImageCandidate): candidate is ProbedImageCandidateWithDimensions {
    return (
      typeof candidate.width === "number" &&
      candidate.width > 0 &&
      typeof candidate.height === "number" &&
      candidate.height > 0
    );
  }

  private canSelectBestImageFromProbe(
    candidates: ProbedImageCandidate[],
  ): candidates is ProbedImageCandidateWithDimensions[] {
    return candidates.length > 0 && candidates.every((candidate) => candidate.ok && this.hasProbeDimensions(candidate));
  }

  private compareImageResolution(
    candidate: Pick<DownloadedImageCandidate, "width" | "height">,
    currentBest: Pick<DownloadedImageCandidate, "width" | "height">,
  ): number {
    const candidatePixels = candidate.width * candidate.height;
    const bestPixels = currentBest.width * currentBest.height;

    if (candidatePixels !== bestPixels) {
      return bestPixels - candidatePixels;
    }

    if (candidate.width !== currentBest.width) {
      return currentBest.width - candidate.width;
    }

    if (candidate.height !== currentBest.height) {
      return currentBest.height - candidate.height;
    }

    return 0;
  }

  private compareProbedImageCandidates(a: ProbedImageCandidate, b: ProbedImageCandidate): number {
    const aHasDimensions = this.hasProbeDimensions(a);
    const bHasDimensions = this.hasProbeDimensions(b);

    if (aHasDimensions && bHasDimensions) {
      const resolutionComparison = this.compareImageResolution(a, b);
      if (resolutionComparison !== 0) {
        return resolutionComparison;
      }
    } else if (aHasDimensions !== bHasDimensions) {
      return aHasDimensions ? -1 : 1;
    }

    if (a.ok !== b.ok) {
      return a.ok ? -1 : 1;
    }

    return (b.contentLength ?? 0) - (a.contentLength ?? 0) || a.index - b.index;
  }

  private async orderImageCandidatesByProbe(
    candidates: string[],
    signal?: AbortSignal,
    captureImageSize = false,
  ): Promise<ProbedImageCandidate[]> {
    throwIfAborted(signal);
    const probedCandidates = await Promise.all(
      candidates.map((url, index) => this.probeImageCandidate(url, index, signal, captureImageSize)),
    );

    return [...probedCandidates].sort((a, b) => this.compareProbedImageCandidates(a, b));
  }

  private async probeImageCandidate(
    url: string,
    index: number,
    signal?: AbortSignal,
    captureImageSize = false,
  ): Promise<ProbedImageCandidate> {
    throwIfAborted(signal);
    if (this.hostCooldown.shouldSkipUrl(url)) {
      return createFailedProbeCandidate(url, index);
    }

    try {
      const result = await this.networkClient.probe(url, { signal, captureImageSize });
      if (!result.ok) {
        this.hostCooldown.recordFailure(url, `HTTP ${result.status}`, result.status);
      }
      return { ...result, index, url };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      this.hostCooldown.recordFailure(url, message);
      return createFailedProbeCandidate(url, index);
    }
  }
}
