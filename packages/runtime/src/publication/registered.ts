import { stat } from "node:fs/promises";
import path from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { createPublicationPlan } from "./createPublicationPlan";
import { commitPublishedMedia } from "./publishMedia";
import type { PublicationPlan, RegisteredPublicationContext } from "./types";

export interface RegisteredPublicationInput {
  operationId: string;
  operationType: PublicationPlan["operationType"];
  sourceVideoPath?: string;
  targetVideoPath?: string;
  artifacts?: Array<{ targetPath: string; content: { kind: "bytes"; data: Buffer } | { kind: "text"; data: string } }>;
  obsoletePaths?: string[];
  replaceExistingTarget?: boolean;
  replaceExistingArtifacts?: boolean;
}

const resolveRegisteredRoot = (roots: readonly Pick<MediaRoot, "id" | "hostPath">[], rootId: string) => {
  const root = roots.find((candidate) => candidate.id === rootId);
  if (!root) throw new Error(`Publication root not found: ${rootId}`);
  return root;
};

export const commitRegisteredPublication = async <TResult>(
  input: RegisteredPublicationInput,
  options: RegisteredPublicationContext & { commit?: () => TResult },
): Promise<TResult | undefined> => {
  const sourceVideoPath = input.sourceVideoPath?.trim();
  const targetVideoPath = input.targetVideoPath?.trim();
  const artifactPaths = input.artifacts?.map((artifact) => artifact.targetPath) ?? [];
  const obsoletePaths = (input.obsoletePaths ?? []).filter(
    (filePath) => !sourceVideoPath || path.resolve(filePath) !== path.resolve(targetVideoPath ?? ""),
  );
  const replaceExistingTargetPaths = [
    ...(input.replaceExistingTarget && targetVideoPath ? [targetVideoPath] : []),
    ...(input.replaceExistingArtifacts ? artifactPaths : []),
  ];
  const plan = createPublicationPlan(
    input.operationId,
    input.operationType,
    {
      video:
        sourceVideoPath && targetVideoPath && sourceVideoPath !== targetVideoPath
          ? {
              sourcePath: sourceVideoPath,
              targetPath: targetVideoPath,
              size: (await stat(sourceVideoPath)).size,
            }
          : undefined,
      artifacts: input.artifacts ?? [],
      assets: [],
      obsoletePaths,
      replaceExistingTargetPaths,
    },
    options.roots,
  );
  return await commitPublishedMedia(plan, {
    resolveRoot: async (rootId) => resolveRegisteredRoot(options.roots, rootId),
    journal: options.journal,
    repairIssues: options.repairIssues,
    commit: options.commit ?? (() => undefined as TResult),
  });
};
