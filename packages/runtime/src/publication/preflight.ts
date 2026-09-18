import { dirname } from "node:path";
import { isPathInside } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationConflictError } from "./conflicts";
import { publicationAssets } from "./libraryEntry";
import type { PublicationPaths } from "./paths";
import { publicationOperations } from "./publicationPlan";
import type {
  PublicationFileSystem,
  PublicationJournalManifestObsolete,
  PublicationObsoleteObservation,
  PublicationOperation,
  PublicationPlan,
} from "./types";

export type ObservedPublicationFile =
  | { path: string; exists: false }
  | { path: string; exists: true; size: number; mtimeMs: number; isFile: boolean };

export interface ResolvedPublicationPlan {
  resolve(ref: RootFileRef): string;
  observed: ObservedPublicationFile[];
}

const refLabel = (ref: RootFileRef): string => `${ref.rootId}:${ref.relativePath}`;

export const planTransfers = (plan: PublicationPlan): Extract<PublicationOperation, { kind: "copy" | "move" }>[] =>
  publicationOperations(plan).filter(
    (operation): operation is Extract<PublicationOperation, { kind: "copy" | "move" }> =>
      operation.kind === "copy" || operation.kind === "move",
  );

export const publicationSources = (plan: PublicationPlan) => (plan.kind === "movie" ? plan.files : plan.sources);

export const planRefs = (plan: PublicationPlan): RootFileRef[] => [
  ...publicationSources(plan).map((file) => file.source),
  ...plan.files.map((file) => file.target),
  ...publicationOperations(plan).flatMap((operation) =>
    operation.kind === "move" ? [operation.source, operation.target] : [operation.target],
  ),
  ...publicationAssets(plan).flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
  ...plan.obsolete,
];

export const observePublicationFile = async (
  fileSystem: Pick<PublicationFileSystem, "stat">,
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
  paths: PublicationPaths,
  fileSystem: Pick<PublicationFileSystem, "stat" | "readFile">,
): Promise<ResolvedPublicationPlan> => {
  if (!plan.operationId.trim()) throw new Error("Publication operation ID is required");
  const resolve = paths.absolute;
  const transfers = planTransfers(plan);
  const transferSourcePath = (operation: (typeof transfers)[number]): string =>
    operation.kind === "copy" ? operation.sourcePath : resolve(operation.source);
  const targets = publicationOperations(plan).map((operation) => operation.target);
  const targetKeys = targets.map(paths.key);
  const collision = targetKeys.findIndex((key, index) => targetKeys.indexOf(key) !== index);
  if (collision >= 0)
    throw new PublicationConflictError(
      publicationSources(plan)[0] ? resolve(publicationSources(plan)[0].source) : resolve(targets[collision]),
      resolve(targets[collision]),
      "发布计划中的实际目标路径重复",
    );
  const observedByPath = new Map<string, ObservedPublicationFile>();
  const record = async (filePath: string): Promise<ObservedPublicationFile> => {
    const existing = observedByPath.get(filePath);
    if (existing) return existing;
    const fact = await observePublicationFile(fileSystem, filePath);
    observedByPath.set(filePath, fact);
    return fact;
  };

  const assetOwners = new Map<string, string>();
  const scopes = [
    { assets: plan.movieAssets, operations: plan.operations, owner: plan.kind },
    ...plan.files.map((file) => ({ assets: file.assets, operations: file.operations, owner: file.fileId })),
  ];
  for (const { assets, owner } of scopes) {
    for (const asset of assets) {
      if (asset.type !== "local") continue;
      const key = paths.key(asset.file);
      const declared = assetOwners.get(key);
      if (declared && declared !== owner)
        throw new PublicationConflictError(
          plan.operationId,
          resolve(asset.file),
          "Publication asset has conflicting scopes",
        );
      assetOwners.set(key, owner);
    }
  }
  for (const { operations, owner } of scopes) {
    for (const operation of operations) {
      const declared = assetOwners.get(paths.key(operation.target));
      if (declared && declared !== owner)
        throw new PublicationConflictError(
          plan.operationId,
          resolve(operation.target),
          "Publication operation does not match its asset scope",
        );
    }
  }
  const movedSources = new Set(
    publicationOperations(plan)
      .filter((operation) => operation.kind === "move")
      .map((operation) => paths.key(operation.source)),
  );
  const rewrittenMediaSources = new Set(
    plan.files
      .filter(
        (media) =>
          paths.key(media.source) !== paths.key(media.target) &&
          publicationOperations(plan).some(
            (operation) => operation.kind === "write" && paths.key(operation.target) === paths.key(media.target),
          ),
      )
      .map((media) => paths.key(media.source)),
  );
  const protectedSources = [
    ...publicationSources(plan)
      .filter(
        (media) => !movedSources.has(paths.key(media.source)) && !rewrittenMediaSources.has(paths.key(media.source)),
      )
      .map((media) => ({ key: paths.key(media.source), path: resolve(media.source) })),
    ...publicationOperations(plan).flatMap((operation) =>
      operation.kind === "copy" && !movedSources.has(paths.pathKey(operation.sourcePath))
        ? [{ key: paths.pathKey(operation.sourcePath), path: operation.sourcePath }]
        : [],
    ),
  ];
  const protectedKeys = new Set(protectedSources.map((source) => source.key));
  for (const media of publicationSources(plan)) {
    if (!protectedKeys.has(paths.key(media.source))) continue;
    const sourceDirectory = dirname(resolve(media.source));
    const physicalSourceDirectory = dirname(paths.key(media.source));
    for (const target of targets) {
      const targetDirectory = dirname(resolve(target));
      if (targetDirectory !== sourceDirectory && isPathInside(physicalSourceDirectory, dirname(paths.key(target))))
        throw new PublicationConflictError(
          resolve(media.source),
          resolve(target),
          "目标路径指向了需保留的原始目录，禁止写入",
        );
    }
  }
  const mutations = [
    ...targets,
    ...plan.obsolete,
    ...publicationOperations(plan).flatMap((operation) => (operation.kind === "move" ? [operation.source] : [])),
  ];
  for (const mutation of mutations) {
    if (!protectedKeys.has(paths.key(mutation))) continue;
    throw new PublicationConflictError(
      protectedSources.find((source) => source.key === paths.key(mutation))?.path ?? resolve(mutation),
      resolve(mutation),
      "受保护的原始文件禁止修改或覆盖（需保留原文件）",
    );
  }
  for (const operation of transfers) {
    if (!Number.isSafeInteger(operation.size) || operation.size < 0)
      throw new Error("Invalid publication transfer size");
    const sourcePath = transferSourcePath(operation);
    const targetPath = resolve(operation.target);
    const source = await record(sourcePath);
    const target = await record(targetPath);
    if (target.exists && !target.isFile) throw new PublicationConflictError(sourcePath, targetPath, "发布目标不是文件");
    if (source.exists) {
      if (!source.isFile || source.size !== operation.size) {
        throw new Error(
          `Publication source size mismatch: ${operation.kind === "copy" ? operation.sourcePath : refLabel(operation.source)}`,
        );
      }
    } else {
      throw new Error(
        `Publication source is missing: ${operation.kind === "copy" ? operation.sourcePath : refLabel(operation.source)}`,
      );
    }
    if (sourcePath !== targetPath && target.exists && (operation.kind === "move" || !operation.replaceExisting))
      throw new PublicationConflictError(sourcePath, targetPath, "目标附属资源已存在且没有替换权限");
  }

  const participating =
    plan.kind === "movie" ? plan.files.map((file) => ({ source: file.source, size: file.sourceSize })) : plan.sources;
  for (const media of participating) {
    const source = await record(resolve(media.source));
    if (!source.exists || !source.isFile || source.size !== media.size)
      throw new Error("Publication participating media is missing or changed");
  }

  for (const operation of publicationOperations(plan)) {
    if (operation.kind !== "write") continue;
    const targetPath = resolve(operation.target);
    const existing = await record(targetPath);
    if (!existing.exists) continue;
    if (!existing.isFile) throw new PublicationConflictError(targetPath, targetPath, "发布目标不是文件");
    const expected = Buffer.from(operation.content.data);
    const actual = await fileSystem.readFile(targetPath);
    if (!actual.equals(expected) && !operation.replaceExisting)
      throw new PublicationConflictError(targetPath, targetPath, "目标资源已存在且没有替换权限");
  }

  for (const ref of plan.obsolete) {
    await record(resolve(ref));
  }
  const plannedTargets = new Set(targets.map((ref) => resolve(ref)));
  for (const asset of publicationAssets(plan)) {
    if (asset.type !== "local") continue;
    const assetPath = resolve(asset.file);
    if (plannedTargets.has(assetPath)) continue;
    const fact = await record(assetPath);
    if (!fact.exists || !fact.isFile) throw new Error(`Publication asset is missing or not a file: ${assetPath}`);
  }

  return { resolve, observed: [...observedByPath.values()] };
};
