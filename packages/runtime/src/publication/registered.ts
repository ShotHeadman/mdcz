import { readFile, stat } from "node:fs/promises";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { runtimeLoggerService } from "../shared";
import { libraryAssetsFromPublicationPlan } from "./libraryEntry";
import { prepareOutputValidation } from "./outputValidation";
import { resolvePublicationParticipants } from "./participants";
import { preparePublicationPaths } from "./paths";
import { assertPublicationFileUnchanged, observePublicationFile, planRefs, preflightPublication } from "./preflight";
import { toRootFileRef } from "./publicationPlan";
import type { PublicationPlan, RegisteredPublicationContext } from "./types";
import { WriteOutput } from "./WriteOutput";

export interface RegisteredPublicationInput {
  operationId: string;
  operationType: PublicationPlan["operationType"];
  mediaPaths?: string[];
  operations: Array<{
    kind: "write";
    owner: "movie" | "unmanaged";
    assetKind?: string;
    targetPath: string;
    content: { kind: "bytes"; data: Buffer } | { kind: "text"; data: string };
    replaceExisting: boolean;
  }>;
}

export const commitRegisteredPublication = async <TResult>(
  input: RegisteredPublicationInput,
  options: RegisteredPublicationContext & { commit?: () => TResult },
): Promise<TResult | undefined> => {
  if (new Set(input.operations.map((operation) => operation.owner)).size > 1)
    throw new Error("Tool publication must have one ownership scope");
  const resolveRoot = async (rootId: string) => {
    const root = options.roots.find((candidate) => candidate.id === rootId);
    if (!root) throw new Error(`Publication root not found: ${rootId}`);
    return root;
  };
  const sources = await Promise.all(
    (input.mediaPaths ?? []).map(async (path) => {
      const stats = await stat(path);
      return { source: toRootFileRef(path, options.roots), size: stats.size, modifiedAt: stats.mtime };
    }),
  );
  let writeAssets: (() => void) | undefined;
  let plan: PublicationPlan = {
    kind: "unmanaged",
    files: [],
    sources,
    operationId: input.operationId,
    operationType: input.operationType,
    movieAssets: [],
    obsolete: [],
    operations: input.operations.map(({ owner, assetKind, targetPath, ...operation }) => ({
      ...operation,
      target: toRootFileRef(targetPath, options.roots),
    })),
  };
  if (options.outputs && input.operations.some((operation) => operation.owner === "movie")) {
    const requested = [...sources.map((file) => file.source), ...plan.operations.map((operation) => operation.target)];
    const paths = await Promise.all(
      requested.map(async (ref) => resolveRootRelativePath(await resolveRoot(ref.rootId), ref.relativePath)),
    );
    const participants = await resolvePublicationParticipants({
      members: sources,
      outputs: plan.operations.map((operation) => operation.target),
      snapshot: options.outputs.publicationSnapshot({ paths, includeOwners: true }),
      resolveRoot,
    });
    if (participants.expected.files.length) {
      const { sources: _sources, ...moviePlan } = plan;
      plan = {
        ...moviePlan,
        kind: "movie",
        movieId: participants.movieId,
        expected: participants.expected,
        files: participants.members.map(({ source, fileId, size, modifiedAt }) => ({
          source,
          target: source,
          fileId,
          size,
          sourceSize: size,
          modifiedAt,
          assets: [],
          operations: [],
        })),
        movieAssets: input.operations.flatMap((operation) =>
          operation.assetKind
            ? [
                {
                  type: "local" as const,
                  kind: operation.assetKind,
                  file: toRootFileRef(operation.targetPath, options.roots),
                },
              ]
            : [],
        ),
      };
      if (!options.library) throw new Error("Registered publication requires scoped library writes");
      const library = options.library;
      const entry = await library.getEntryById(plan.movieId);
      const changed = libraryAssetsFromPublicationPlan(plan, plan.movieAssets);
      if (changed.some((asset) => asset.kind === "strm" || asset.kind === "subtitle"))
        throw new Error("Registered tools only write movie assets");
      const assets = changed.length
        ? [
            ...entry.assets.filter(
              (asset) =>
                !asset.historical &&
                asset.fileId === null &&
                !changed.some(
                  (replacement) =>
                    replacement.kind === asset.kind &&
                    replacement.rootId === asset.rootId &&
                    replacement.relativePath === asset.relativePath,
                ),
            ),
            ...changed,
          ]
        : undefined;
      writeAssets = () => {
        library.writeEntry({ id: participants.movieId, assets }, []);
      };
    }
  }
  const paths = await preparePublicationPaths(planRefs(plan), { resolveRoot, outputs: options.outputs });
  const release = mediaPathOwnership.acquireAll(planRefs(plan).map(paths.key));
  try {
    const resolved = await preflightPublication(plan, paths, { stat, readFile });
    const validation = await prepareOutputValidation(
      plan,
      { outputs: options.outputs, resolveRoot },
      paths,
      resolved.observed,
    );
    const artifacts = [];
    for (const operation of input.operations) {
      const ref = toRootFileRef(operation.targetPath, options.roots);
      const targetPath = resolved.resolve(ref);
      const observed = resolved.observed.find((file) => file.path === targetPath);
      if (observed?.exists && !operation.replaceExisting) continue;
      artifacts.push({ targetPath, data: operation.content.data });
    }
    const published = await new WriteOutput().install(artifacts, {
      validate: async () => {
        for (const observed of resolved.observed)
          assertPublicationFileUnchanged(observed, await observePublicationFile({ stat }, observed.path));
        validation?.assertCurrent();
      },
      commit: () => {
        writeAssets?.();
        return options.commit ? options.commit() : (undefined as TResult);
      },
    });
    for (const issue of published.cleanupIssues)
      runtimeLoggerService.getLogger("Publication").warn(`Publication cleanup failed: ${String(issue)}`);
    return published.value;
  } finally {
    release();
  }
};
