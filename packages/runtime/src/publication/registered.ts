import { stat } from "node:fs/promises";
import path from "node:path";
import { capturePublicationBoundary } from "./boundary";

export { capturePublicationBoundary } from "./boundary";

import { createPublicationPlan } from "./createPublicationPlan";
import { commitPublishedMedia } from "./publishMedia";
import type { PublicationPlan, RegisteredPublicationContext } from "./types";

export interface RegisteredPublicationInput {
  operationId: string;
  operationType: PublicationPlan["operationType"];
  sourceVideoPath?: string;
  mediaPaths?: string[];
  targetVideoPath?: string;
  artifacts?: Array<{
    kind?: string;
    targetPath: string;
    content: { kind: "bytes"; data: Buffer } | { kind: "text"; data: string };
  }>;
  replaceExistingTarget?: boolean;
  replaceExistingArtifacts?: boolean;
  editExistingFiles?: boolean;
  readOnlyDirectories?: string[];
}

export const commitRegisteredPublication = async <TResult>(
  input: RegisteredPublicationInput,
  options: RegisteredPublicationContext & { commit?: () => TResult },
): Promise<TResult | undefined> => {
  const sourceVideoPath = input.sourceVideoPath?.trim();
  const targetVideoPath = input.targetVideoPath?.trim();
  const artifactPaths = input.artifacts?.map((artifact) => artifact.targetPath) ?? [];
  const replaceExistingTargetPaths = [
    ...(input.replaceExistingTarget && targetVideoPath ? [targetVideoPath] : []),
    ...(input.replaceExistingArtifacts ? artifactPaths : []),
  ];
  const plan = createPublicationPlan(
    input.operationId,
    input.operationType,
    {
      boundary: input.readOnlyDirectories?.length
        ? await capturePublicationBoundary({
            writeRoots: artifactPaths.map((target) => path.dirname(target)),
            writablePaths: artifactPaths,
            readOnlyPaths: [],
            readOnlyDirectories: input.readOnlyDirectories,
          })
        : undefined,
      media: await Promise.all(
        (input.mediaPaths ?? (sourceVideoPath ? [sourceVideoPath] : [])).map(async (path) => ({
          sourcePath: path,
          targetPath: path === sourceVideoPath ? (targetVideoPath ?? path) : path,
          size: (await stat(path)).size,
        })),
      ),
      videos:
        sourceVideoPath && targetVideoPath && sourceVideoPath !== targetVideoPath
          ? [
              {
                sourcePath: sourceVideoPath,
                targetPath: targetVideoPath,
                size: (await stat(sourceVideoPath)).size,
              },
            ]
          : undefined,
      artifacts: input.artifacts ?? [],
      assets: (input.artifacts ?? []).flatMap((artifact) =>
        artifact.kind ? [{ kind: artifact.kind, targetPath: artifact.targetPath }] : [],
      ),
      obsoletePaths: [],
      replaceExistingTargetPaths,
    },
    options.roots,
  );
  if (input.editExistingFiles) plan.editFiles = plan.artifacts.map((artifact) => artifact.target);
  return await commitPublishedMedia(plan, {
    resolveRoot: async (rootId) => {
      const root = options.roots.find((candidate) => candidate.id === rootId);
      if (!root) throw new Error(`Publication root not found: ${rootId}`);
      return root;
    },
    journal: options.journal,
    outputs: options.outputs,
    repairIssues: options.repairIssues,
    commit: options.commit ?? (() => undefined as TResult),
  });
};
