import { mediaPathOwnership } from "@mdcz/runtime/library";
import { commitPublishedMedia, PublicationError } from "@mdcz/runtime/publication";
import { type FileScrapeResult, formatDiskCommitFailure } from "@mdcz/runtime/scrape";
import type { ScrapeRunItem } from "@mdcz/runtime/tasks";
import type { ScrapeResult } from "@mdcz/shared/types";
import type { DesktopPersistenceService } from "../persistence";

export class DesktopScrapePublisher {
  constructor(private readonly persistence: DesktopPersistenceService) {}

  async commitItem(runId: string, item: ScrapeRunItem, result: ScrapeResult): Promise<ScrapeResult> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    if (result.status === "failed") {
      const outcome = await repository.commitOutcome({
        outcome: "failed",
        itemId: item.id,
        error: result.error?.trim() || "刮削失败",
      });
      return { ...result, resultId: outcome.id, status: "failed" };
    }
    if (result.status === "skipped") {
      const outcome = await repository.commitOutcome({
        outcome: "skipped",
        itemId: item.id,
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
          error: coordinatedError,
        });
        return { ...result, resultId: outcome.id, status: "failed", error: coordinatedError };
      } catch (failureError) {
        throw new AggregateError([error, failureError], coordinatedError);
      }
    }
  }

  private async commitSuccess(runId: string, item: ScrapeRunItem, result: ScrapeResult): Promise<ScrapeResult> {
    if (!result.crawlerData) throw new Error(`Successful scrape has no crawler data: ${item.relativePath}`);
    const plan = (result as FileScrapeResult).publicationPlan;
    if (!plan?.video) throw new Error(`Successful scrape has no publication plan: ${item.relativePath}`);
    const crawlerData = result.crawlerData;
    const output = plan.video.target;
    const completedAt = new Date();
    const nfo = result.nfo ?? null;
    const thumbnail = plan.assets.find((asset) => asset.kind === "poster" || asset.kind === "thumb");
    const thumbnailPath = thumbnail ? (thumbnail.type === "local" ? thumbnail.file.relativePath : thumbnail.url) : null;
    const libraryAssets = plan.assets.map((asset) =>
      asset.type === "local"
        ? {
            kind: asset.kind,
            uri: asset.file.relativePath,
            rootId: asset.file.rootId,
            relativePath: asset.file.relativePath,
          }
        : { kind: asset.kind, uri: asset.url },
    );
    const crawlerDataJson = JSON.stringify(crawlerData);
    const state = await this.persistence.getState();
    const committed = await commitPublishedMedia(plan, {
      resolveRoot: async (rootId) => await state.repositories.mediaRoots.get(rootId),
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs),
      journal: state.repositories.publicationJournal,
      repairIssues: state.repositories.libraryRepairIssues,
      commit: () =>
        state.repositories.scrapeRuns.commitSuccessOutcome({
          outcome: "success",
          itemId: item.id,
          crawlerDataJson,
          nfoRootId: nfo?.rootId ?? null,
          nfoRelativePath: nfo?.relativePath ?? null,
          outputRootId: output.rootId,
          outputRelativePath: output.relativePath,
          uncensoredAmbiguous: result.uncensoredAmbiguous ?? false,
          size: plan.video?.size ?? 0,
          modifiedAt: null,
          completedAt,
          libraryEntry: {
            mediaIdentity: crawlerData.number || result.fileName,
            rootId: output.rootId,
            rootRelativePath: output.relativePath,
            size: plan.video?.size ?? 0,
            title: crawlerData.title,
            number: crawlerData.number || result.fileName,
            actors: crawlerData.actors,
            crawlerDataJson,
            thumbnailPath,
            assets: libraryAssets,
            lastKnownPath: output.relativePath,
            createdAt: completedAt,
          },
        }),
    }).catch(async (error) => {
      if (!(error instanceof PublicationError && error.committed)) throw error;
      const run = await state.repositories.scrapeRuns.get(runId);
      const outcome = run.outcomes.find((candidate) => candidate.itemId === item.id);
      if (!outcome) throw error;
      const entry = await state.repositories.library.getEntryBySourceOutcomeId(outcome.id);
      if (!entry) throw error;
      return { outcomeId: outcome.id, entryId: entry.id };
    });
    return { ...result, resultId: committed.outcomeId };
  }
}
