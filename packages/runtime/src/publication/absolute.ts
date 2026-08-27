import { stat } from "node:fs/promises";
import path from "node:path";
import { toRootFileRef } from "./createPublicationPlan";
import { commitPublishedMedia } from "./publishMedia";
import type { PublicationPlan, PublicationRepairPort } from "./types";

type AbsolutePublicationRoot = { id: string; hostPath: string };

const rootForPath = (filePath: string): AbsolutePublicationRoot => {
  const hostPath = path.parse(path.resolve(filePath)).root;
  return { id: `absolute:${hostPath}`, hostPath };
};

const rootsFor = (paths: readonly string[]): AbsolutePublicationRoot[] => {
  const roots = new Map<string, AbsolutePublicationRoot>();
  for (const filePath of paths) {
    const root = rootForPath(filePath);
    roots.set(root.id, root);
  }
  return [...roots.values()];
};

export interface AbsolutePublicationInput {
  operationId: string;
  operationType: PublicationPlan["operationType"];
  sourceVideoPath?: string;
  targetVideoPath?: string;
  artifacts?: Array<{ targetPath: string; content: { kind: "bytes"; data: Buffer } | { kind: "text"; data: string } }>;
  obsoletePaths?: string[];
  replaceExistingTarget?: boolean;
  replaceExistingArtifacts?: boolean;
}

export const commitAbsolutePublication = async <TResult>(
  input: AbsolutePublicationInput,
  options: {
    commit?: () => Promise<TResult>;
    repairIssues?: PublicationRepairPort;
  } = {},
): Promise<TResult | undefined> => {
  const sourceVideoPath = input.sourceVideoPath?.trim();
  const targetVideoPath = input.targetVideoPath?.trim();
  const artifactPaths = input.artifacts?.map((artifact) => artifact.targetPath) ?? [];
  const obsoletePaths = input.obsoletePaths ?? [];
  const roots = rootsFor([
    ...(sourceVideoPath ? [sourceVideoPath] : []),
    ...(targetVideoPath ? [targetVideoPath] : []),
    ...artifactPaths,
    ...obsoletePaths,
  ]);
  const toRef = (filePath: string) => toRootFileRef(filePath, roots);
  const sourceAndTarget =
    sourceVideoPath && targetVideoPath
      ? {
          source: toRef(sourceVideoPath),
          target: toRef(targetVideoPath),
          size: (await stat(sourceVideoPath)).size,
        }
      : undefined;
  const plan: PublicationPlan = {
    operationId: input.operationId,
    operationType: input.operationType,
    video: sourceAndTarget && sourceVideoPath !== targetVideoPath ? sourceAndTarget : undefined,
    artifacts: (input.artifacts ?? []).map((artifact) => ({
      target: toRef(artifact.targetPath),
      content: artifact.content,
    })),
    assets: [],
    obsolete: obsoletePaths
      .filter((filePath) => !sourceVideoPath || path.resolve(filePath) !== path.resolve(targetVideoPath ?? ""))
      .map(toRef),
    replaceExistingTargets: [
      ...(input.replaceExistingTarget && targetVideoPath ? [toRef(targetVideoPath)] : []),
      ...(input.replaceExistingArtifacts ? artifactPaths.map(toRef) : []),
    ],
  };
  return await commitPublishedMedia(plan, {
    resolveRoot: async (rootId) => {
      const root = roots.find((candidate) => candidate.id === rootId);
      if (!root) throw new Error(`Absolute publication root not found: ${rootId}`);
      return root;
    },
    repairIssues: options.repairIssues,
    commit: options.commit ?? (async () => undefined),
  });
};

export const publishAbsoluteFile = async (
  sourcePath: string,
  targetPath: string,
  operationId: string,
): Promise<void> => {
  await commitAbsolutePublication({
    operationId,
    operationType: "maintenance",
    sourceVideoPath: sourcePath,
    targetVideoPath: targetPath,
  });
};

export const removeAbsoluteFiles = async (filePaths: readonly string[], operationId: string): Promise<void> => {
  if (filePaths.length === 0) return;
  await commitAbsolutePublication({ operationId, operationType: "maintenance", obsoletePaths: [...filePaths] });
};
