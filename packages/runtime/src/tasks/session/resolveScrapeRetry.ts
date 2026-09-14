import { stat } from "node:fs/promises";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";

export const resolveScrapeAttempts = <TOutcome extends { attemptId: string; itemId: string }>(manifest: {
  attempts: readonly { id: string; itemId: string }[];
  outcomes: readonly TOutcome[];
}) => {
  const settled = new Set(manifest.outcomes.map((outcome) => outcome.attemptId));
  return {
    openAttemptByItemId: new Map(
      manifest.attempts.filter((attempt) => !settled.has(attempt.id)).map((attempt) => [attempt.itemId, attempt.id]),
    ),
    latestOutcomeByItemId: new Map(manifest.outcomes.map((outcome) => [outcome.itemId, outcome])),
  };
};

export const resolveScrapeRetry = async (input: {
  item: RootFileRef;
  retrying: boolean;
  latestOutcome?: { outcome: string; outputRootId: string | null; outputRelativePath: string | null };
  outputRoot: Pick<MediaRoot, "id" | "hostPath">;
  outputRelativeDirectory: string;
  resolveRoot(id: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<{ sourcePath: string; executionSource?: RootFileRef; outputTemplateRoot?: string }> => {
  const sourceRoot = await input.resolveRoot(input.item.rootId);
  const sourcePath = resolveRootRelativePath(sourceRoot, input.item.relativePath);
  if (!input.retrying) return { sourcePath };
  const candidates: RootFileRef[] = [];
  const outcome = input.latestOutcome;
  if (outcome?.outcome === "success" && outcome.outputRootId && outcome.outputRelativePath) {
    candidates.push({ rootId: outcome.outputRootId, relativePath: outcome.outputRelativePath });
  }
  candidates.push(input.item);
  for (const candidate of candidates) {
    const root =
      candidate.rootId === input.outputRoot.id ? input.outputRoot : await input.resolveRoot(candidate.rootId);
    const candidatePath = resolveRootRelativePath(root, candidate.relativePath);
    const exists = await stat(candidatePath)
      .then((value) => value.isFile())
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (!exists) continue;
    return {
      sourcePath: candidatePath,
      executionSource: candidate,
      outputTemplateRoot: resolveRootRelativePath(input.outputRoot, input.outputRelativeDirectory),
    };
  }
  throw new Error(`Retry source is missing: ${sourcePath}`);
};
