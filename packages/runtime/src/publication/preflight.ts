import { resolveRootRelativePath } from "@mdcz/media-store";
import { parseWireRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";
import { assertPublicationBoundary, publicationPathKey, resolvePublicationPath } from "./boundary";
import { PublicationConflictError } from "./conflicts";
import type {
  PublicationFileSystem,
  PublicationJournalManifestObsolete,
  PublicationMove,
  PublicationObsoleteObservation,
  PublicationPlan,
  PublishMediaOptions,
} from "./types";

export type ObservedPublicationFile =
  | { path: string; exists: false }
  | { path: string; exists: true; size: number; mtimeMs: number; isFile: boolean };

export interface ResolvedPublicationPlan {
  roots: Map<string, Awaited<ReturnType<PublishMediaOptions<unknown>["resolveRoot"]>>>;
  resolve(ref: RootFileRef): string;
  observed: ObservedPublicationFile[];
}

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${parseWireRelativePath(ref.relativePath)}`;

const refLabel = (ref: RootFileRef): string => `${ref.rootId}:${ref.relativePath}`;

export const planMoves = (plan: PublicationPlan): PublicationMove[] => [
  ...(plan.videos ?? []),
  ...(plan.sidecars ?? []),
];

export const planRefs = (plan: PublicationPlan): RootFileRef[] => [
  ...(plan.media ?? []).flatMap((media) => [media.source, media.target]),
  ...planMoves(plan).flatMap((move) => [move.source, move.target]),
  ...plan.artifacts.map(({ target }) => target),
  ...plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
  ...plan.obsolete,
];

export const observePublicationFile = async (
  fileSystem: PublicationFileSystem,
  filePath: string,
): Promise<ObservedPublicationFile> => {
  try {
    const stats = await fileSystem.stat(filePath);
    return { path: filePath, exists: true, size: stats.size, mtimeMs: stats.mtimeMs, isFile: stats.isFile() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: filePath, exists: false };
    throw error;
  }
};

export const publicationFilesMatch = (previous: ObservedPublicationFile, current: ObservedPublicationFile): boolean => {
  if (!previous.exists && !current.exists) return true;
  return (
    previous.exists === current.exists &&
    previous.exists &&
    current.exists &&
    current.size === previous.size &&
    current.mtimeMs === previous.mtimeMs &&
    current.isFile === previous.isFile
  );
};

export const assertPublicationFileUnchanged = (
  previous: ObservedPublicationFile,
  current: ObservedPublicationFile,
): void => {
  if (!publicationFilesMatch(previous, current)) {
    throw new Error(`Publication path changed before mutation: ${previous.path}`);
  }
};

export const toObsoleteObservation = (file: ObservedPublicationFile): PublicationObsoleteObservation =>
  file.exists ? { exists: true, size: file.size, mtimeMs: file.mtimeMs, isFile: file.isFile } : { exists: false };

export const removeCommittedObsoleteFiles = async (
  fileSystem: PublicationFileSystem,
  obsolete: readonly PublicationJournalManifestObsolete[],
  resolve: (rootId: string, relativePath: string) => string | Promise<string>,
  isReferenced?: (ref: RootFileRef) => Promise<boolean>,
): Promise<RootFileRef[]> => {
  const retained: RootFileRef[] = [];
  for (const ref of obsolete) {
    const obsoletePath = await resolve(ref.rootId, ref.relativePath);
    const current = await observePublicationFile(fileSystem, obsoletePath);
    if (!current.exists) continue;
    const expected: ObservedPublicationFile = ref.observed.exists
      ? {
          path: obsoletePath,
          exists: true,
          size: ref.observed.size,
          mtimeMs: ref.observed.mtimeMs,
          isFile: ref.observed.isFile,
        }
      : { path: obsoletePath, exists: false };
    if (publicationFilesMatch(expected, current) && !(await isReferenced?.(ref))) {
      await fileSystem.rm(obsoletePath, { force: true });
      continue;
    }
    retained.push({ rootId: ref.rootId, relativePath: ref.relativePath });
  }
  return retained;
};

export const preflightPublication = async (
  plan: PublicationPlan,
  options: Pick<PublishMediaOptions<unknown>, "resolveRoot">,
  fileSystem: PublicationFileSystem,
  previous?: readonly ObservedPublicationFile[],
): Promise<ResolvedPublicationPlan> => {
  if (!plan.operationId.trim()) throw new Error("Publication operation ID is required");
  if (plan.boundary) await assertPublicationBoundary(plan.boundary);
  const refs = planRefs(plan);
  const rootIds = [...new Set(refs.map((ref) => ref.rootId))];
  const roots = new Map(
    await Promise.all(rootIds.map(async (rootId) => [rootId, await options.resolveRoot(rootId)] as const)),
  );
  const resolve = (ref: RootFileRef): string => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root not resolved: ${ref.rootId}`);
    return resolveRootRelativePath(root, parseWireRelativePath(ref.relativePath));
  };
  const moves = planMoves(plan);
  const targets = [...moves.map((move) => move.target), ...plan.artifacts.map(({ target }) => target)];
  for (const fact of previous ?? []) {
    const current = await observePublicationFile(fileSystem, fact.path);
    if (!publicationFilesMatch(fact, current) && targets.some((target) => resolve(target) === fact.path)) {
      const move = moves.find((move) => resolve(move.target) === fact.path);
      throw new PublicationConflictError(
        move ? resolve(move.source) : fact.path,
        fact.path,
        "发布目标在预检期间发生变化",
      );
    }
    assertPublicationFileUnchanged(fact, current);
  }
  const targetKeys = await Promise.all(
    targets.map(async (ref) => publicationPathKey(await resolvePublicationPath(resolve(ref)))),
  );
  const collision = targetKeys.findIndex((key, index) => targetKeys.indexOf(key) !== index);
  if (collision >= 0)
    throw new PublicationConflictError(
      plan.media?.[0] ? resolve(plan.media[0].source) : resolve(targets[collision]),
      resolve(targets[collision]),
      "发布计划中的实际目标路径重复",
    );
  const replacing = new Set((plan.replaceExistingTargets ?? []).map(refKey));
  const observedByPath = new Map<string, ObservedPublicationFile>();
  const record = async (filePath: string): Promise<ObservedPublicationFile> => {
    const existing = observedByPath.get(filePath);
    if (existing) return existing;
    const fact = await observePublicationFile(fileSystem, filePath);
    observedByPath.set(filePath, fact);
    return fact;
  };

  if (plan.boundary) {
    const declared = new Set(plan.boundary.writablePaths.map((path) => publicationPathKey(path.path)));
    const mutations = [
      ...targets,
      ...plan.obsolete,
      ...moves.filter((move) => !move.preserveSource).map((move) => move.source),
    ];
    for (const ref of mutations)
      if (!declared.has(publicationPathKey(resolve(ref))))
        throw new Error(`Publication mutation was not declared: ${resolve(ref)}`);
  }
  for (const media of plan.media ?? []) {
    const source = await record(resolve(media.source));
    if (!source.exists || !source.isFile || source.size !== media.size)
      throw new Error("Publication participating media is missing or changed");
  }

  for (const move of moves) {
    if (!Number.isSafeInteger(move.size) || move.size < 0) throw new Error("Invalid publication move size");
    const sourcePath = resolve(move.source);
    const targetPath = resolve(move.target);
    const source = await record(sourcePath);
    const target = await record(targetPath);
    if (plan.videos?.includes(move) && sourcePath !== targetPath && source.exists && target.exists) {
      throw new PublicationConflictError(sourcePath, targetPath);
    }
    if (target.exists && !target.isFile) throw new PublicationConflictError(sourcePath, targetPath, "发布目标不是文件");
    if (move.shared && target.exists && !source.exists) {
      plan.sidecars = plan.sidecars?.filter((candidate) => candidate !== move);
      continue;
    }
    if (source.exists) {
      if (!source.isFile || source.size !== move.size) {
        throw new Error(`Publication source size mismatch: ${refLabel(move.source)}`);
      }
    } else {
      throw new Error(`Publication source is missing: ${refLabel(move.source)}`);
    }
    if (
      !plan.videos?.includes(move) &&
      sourcePath !== targetPath &&
      target.exists &&
      !replacing.has(refKey(move.target))
    )
      throw new PublicationConflictError(sourcePath, targetPath, "目标附属资源已存在且没有替换权限");
  }

  for (const artifact of plan.artifacts) {
    const targetPath = resolve(artifact.target);
    const existing = await record(targetPath);
    if (!existing.exists) continue;
    if (!existing.isFile) throw new PublicationConflictError(targetPath, targetPath, "发布目标不是文件");
    if (artifact.content.kind === "download") {
      if (!replacing.has(refKey(artifact.target)))
        throw new PublicationConflictError(targetPath, targetPath, "下载目标已存在");
      continue;
    }
    if (artifact.content.kind === "file") {
      if (!replacing.has(refKey(artifact.target)))
        throw new PublicationConflictError(targetPath, targetPath, "目标资源已存在且没有替换权限");
      continue;
    }
    const expected = Buffer.from(artifact.content.data);
    const actual = await fileSystem.readFile(targetPath);
    if (!actual.equals(expected) && !replacing.has(refKey(artifact.target)))
      throw new PublicationConflictError(targetPath, targetPath, "目标资源已存在且没有替换权限");
  }

  for (const ref of plan.obsolete) {
    await record(resolve(ref));
  }
  const plannedTargets = new Set(targets.map((ref) => resolve(ref)));
  for (const asset of plan.assets) {
    if (asset.type !== "local") continue;
    const assetPath = resolve(asset.file);
    if (plannedTargets.has(assetPath)) continue;
    const fact = await record(assetPath);
    if (!fact.exists || !fact.isFile) throw new Error(`Publication asset is missing or not a file: ${assetPath}`);
  }

  return { roots, resolve, observed: [...observedByPath.values()] };
};
