import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationJournalAdapter } from "./journalAdapter";
import { assertMoveTargetAbsent, returnMovedFile } from "./MoveOutput";
import { outputFileSystem } from "./outputFileSystem";
import { observePublicationFile } from "./preflight";
import type {
  PublicationFileSystem,
  PublicationJournalPort,
  PublicationOutputPort,
  PublicationRepairPort,
} from "./types";

export interface RecoverPublicationsOptions {
  journal: PublicationJournalPort;
  outputs?: PublicationOutputPort;
  resolveRoot(rootId: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
  repairIssues?: PublicationRepairPort;
  fileSystem?: PublicationFileSystem;
}

export const recoverPublications = async (options: RecoverPublicationsOptions): Promise<void> => {
  const fs = options.fileSystem ?? outputFileSystem;
  const resolve = async (ref: RootFileRef) =>
    resolveRootRelativePath(await options.resolveRoot(ref.rootId), ref.relativePath);
  const records = options.journal.listUnfinished();
  if (options.journal instanceof PublicationJournalAdapter) {
    for (const invalid of options.journal.invalidManifests())
      await options.repairIssues?.record({
        ...invalid,
        operationType: invalid.operationType === "scrape" ? "scrape" : "maintenance",
        rootId: "unknown",
        relativePath: invalid.operationId,
        errorMessage: "Publication journal manifest is invalid",
      });
  }
  for (const record of records) {
    let failed = false;
    for (const entry of [...record.manifest.entries].reverse()) {
      try {
        const source = await resolve(entry.source);
        const target = await resolve(entry);
        const staged = await resolve({ rootId: entry.rootId, relativePath: entry.temporaryPath });
        const sourceExists = (await observePublicationFile(fs, source)).exists;
        const targetExists = (await observePublicationFile(fs, target)).exists;
        const stagedExists = (await observePublicationFile(fs, staged)).exists;
        if (record.state === "pending") {
          if (!sourceExists) {
            if (!stagedExists && (!targetExists || entry.rewritten))
              throw new Error(`Pending move is missing its original bytes: ${source}`);
            await returnMovedFile(fs, stagedExists ? staged : target, source);
            if (entry.rewritten && targetExists) await fs.rm(target, { force: true });
          } else if (targetExists) {
            throw new Error(`Pending move has both source and target; refusing to delete either: ${target}`);
          }
          await fs.rm(staged, { force: true });
        } else {
          if (!targetExists) {
            if (!stagedExists || entry.rewritten) throw new Error(`Committed move is missing its target: ${target}`);
            await assertMoveTargetAbsent(target);
            await fs.rename(staged, target);
          }
          if (sourceExists) throw new Error(`Committed move source was recreated: ${source}`);
          await fs.rm(staged, { force: true });
        }
        await options.repairIssues?.resolve(record.operationId, entry.rootId, entry.relativePath);
      } catch (error) {
        failed = true;
        await options.repairIssues?.record({
          operationId: record.operationId,
          operationType: record.operationType === "scrape" ? "scrape" : "maintenance",
          rootId: entry.rootId,
          relativePath: entry.relativePath,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!failed) options.journal.finish(record.operationId);
  }
};
