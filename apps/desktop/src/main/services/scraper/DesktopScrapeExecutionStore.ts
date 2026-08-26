import { stat } from "node:fs/promises";
import type { MediaRoot } from "@mdcz/media-store";
import { toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeRunManifest, ScrapeRunSummaryRecord } from "@mdcz/persistence";
import { createDesktopInputRoot, resolveDesktopInputRootPath, toLibraryAssets } from "@mdcz/runtime/library";
import { formatDiskCommitFailure } from "@mdcz/runtime/scrape";
import type { ScrapeRunItem } from "@mdcz/runtime/tasks";
import type { ScrapeResult } from "@mdcz/shared/types";
import type { DesktopPersistenceService } from "../persistence";

interface DesktopScrapeRunContext {
  manifest: ScrapeRunManifest;
  inputRoot: MediaRoot;
  requestedOutputRoot: MediaRoot | null;
}

export class DesktopScrapeExecutionStore {
  private readonly contextByRunId = new Map<string, DesktopScrapeRunContext>();

  constructor(
    private readonly persistence: DesktopPersistenceService,
    private readonly getConfiguredMediaPath: () => Promise<string>,
  ) {}

  async createRun(files: readonly string[], executionMode: "single" | "batch", requestedOutputRoot: MediaRoot | null) {
    const state = await this.persistence.getState();
    const configuredMediaPath = (await this.getConfiguredMediaPath()).trim();
    const inputRoot = createDesktopInputRoot(resolveDesktopInputRootPath(files, configuredMediaPath || undefined));
    await state.repositories.mediaRoots.upsert(inputRoot);
    if (requestedOutputRoot) await state.repositories.mediaRoots.upsert(requestedOutputRoot);

    const manifest = await state.repositories.scrapeRuns.create({
      rootId: inputRoot.id,
      outputRootId: requestedOutputRoot?.id ?? null,
      executionMode,
      items: files.map((sourcePath, ordinal) => ({
        ordinal,
        rootId: inputRoot.id,
        relativePath: toRootRelativePath(inputRoot, sourcePath),
      })),
    });
    this.contextByRunId.set(manifest.id, { manifest, inputRoot, requestedOutputRoot });
    return {
      manifest,
      items: manifest.items.map((item) => ({
        id: item.id,
        rootId: item.rootId,
        relativePath: item.relativePath,
        sourcePath: files[item.ordinal],
        attempt: 1,
      })),
    };
  }

  async commitItem(runId: string, item: ScrapeRunItem, result: ScrapeResult): Promise<ScrapeResult> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    if (result.status === "failed") {
      const outcome = await repository.commitOutcome({
        outcome: "failed",
        itemId: item.id,
        attempt: item.attempt,
        error: result.error?.trim() || "刮削失败",
      });
      return { ...result, resultId: outcome.id, status: "failed" };
    }
    if (result.status === "skipped") {
      const outcome = await repository.commitOutcome({
        outcome: "skipped",
        itemId: item.id,
        attempt: item.attempt,
        error: result.error?.trim() || null,
      });
      return { ...result, resultId: outcome.id, status: "skipped" };
    }
    if (result.status !== "success") {
      throw new Error(`Cannot commit non-terminal scrape result: ${result.status}`);
    }

    try {
      return await this.commitSuccess(runId, item, result);
    } catch (error) {
      const coordinatedError = formatDiskCommitFailure(error);
      try {
        const outcome = await repository.commitOutcome({
          outcome: "failed",
          itemId: item.id,
          attempt: item.attempt,
          error: coordinatedError,
        });
        return { ...result, resultId: outcome.id, status: "failed", error: coordinatedError };
      } catch (failureError) {
        throw new AggregateError([error, failureError], coordinatedError);
      }
    }
  }

  async finalizeRun(
    runId: string,
    disposition: "completed" | "failed" | "stopped",
    options: { error?: string | null; startedAt?: Date | null } = {},
  ): Promise<ScrapeRunSummaryRecord> {
    const state = await this.persistence.getState();
    const finalized = await state.repositories.scrapeRuns.finalize({
      runId,
      disposition,
      error: options.error ?? null,
      startedAt: options.startedAt ?? null,
    });
    const summary = state.repositories.scrapeRuns.summary(finalized);
    if (!summary) throw new Error(`Scrape run finalization disappeared after update: ${runId}`);
    return summary;
  }

  private async commitSuccess(runId: string, item: ScrapeRunItem, result: ScrapeResult): Promise<ScrapeResult> {
    if (!result.crawlerData) throw new Error(`Successful scrape has no crawler data: ${item.relativePath}`);
    const context = await this.getContext(runId);
    const roots = context.requestedOutputRoot ? [context.inputRoot, context.requestedOutputRoot] : [context.inputRoot];
    const output = this.resolveLongestContainingRoot(roots, result.fileInfo.filePath);
    const metadata = await stat(result.fileInfo.filePath);
    if (!metadata.isFile()) throw new Error(`Scrape output is not a file: ${result.fileInfo.filePath}`);
    const completedAt = new Date();
    const nfo = result.nfoPath ? this.resolveLongestContainingRoot(roots, result.nfoPath) : null;
    const thumbnailCandidate = result.assets?.poster ?? result.assets?.thumb;
    let thumbnailPath: string | null = null;
    if (thumbnailCandidate) {
      try {
        thumbnailPath = toRootRelativePath(output.root, thumbnailCandidate);
      } catch {
        thumbnailPath = null;
      }
    }
    const crawlerDataJson = JSON.stringify(result.crawlerData);
    const committed = await (await this.persistence.getState()).repositories.scrapeRuns.commitOutcome({
      outcome: "success",
      itemId: item.id,
      attempt: item.attempt,
      crawlerDataJson,
      nfoRootId: nfo?.root.id ?? null,
      nfoRelativePath: nfo?.relativePath ?? null,
      outputRootId: output.root.id,
      outputRelativePath: output.relativePath,
      uncensoredAmbiguous: result.uncensoredAmbiguous ?? false,
      size: metadata.size,
      modifiedAt: metadata.mtime,
      completedAt,
      libraryEntry: {
        mediaIdentity: result.crawlerData.number || result.fileInfo.number,
        rootId: output.root.id,
        rootRelativePath: output.relativePath,
        size: metadata.size,
        title: result.crawlerData.title,
        number: result.crawlerData.number || result.fileInfo.number,
        actors: result.crawlerData.actors,
        crawlerDataJson,
        thumbnailPath,
        assets: toLibraryAssets(output.root, result.assets),
        lastKnownPath: output.relativePath,
        createdAt: completedAt,
      },
    });
    if (!("entry" in committed)) throw new Error(`Successful scrape outcome was not committed: ${item.id}`);
    return { ...result, resultId: committed.outcome.id };
  }

  private async getContext(runId: string): Promise<DesktopScrapeRunContext> {
    const cached = this.contextByRunId.get(runId);
    if (cached) return cached;
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(runId);
    const inputRoot = await state.repositories.mediaRoots.get(manifest.rootId, { includeDeleted: true });
    const requestedOutputRoot = manifest.requestedOutputRootId
      ? await state.repositories.mediaRoots.get(manifest.requestedOutputRootId, { includeDeleted: true })
      : null;
    const context = { manifest, inputRoot, requestedOutputRoot };
    this.contextByRunId.set(runId, context);
    return context;
  }

  private resolveLongestContainingRoot(
    roots: readonly MediaRoot[],
    filePath: string,
  ): { root: MediaRoot; relativePath: string } {
    const candidates: Array<{ root: MediaRoot; relativePath: string }> = [];
    const seen = new Set<string>();
    for (const root of roots) {
      if (seen.has(root.id)) continue;
      seen.add(root.id);
      try {
        candidates.push({ root, relativePath: toRootRelativePath(root, filePath) });
      } catch {
        // The path belongs to another configured candidate, or to neither root.
      }
    }
    candidates.sort((left, right) => right.root.hostPath.length - left.root.hostPath.length);
    const selected = candidates[0];
    if (!selected) {
      throw new Error(`Scrape output is outside the input and configured output roots: ${filePath}`);
    }
    return selected;
  }
}
