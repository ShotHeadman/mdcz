import { lstat, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { MediaPathBusyError, mediaPathOwnership } from "../library/mediaPathOwnership";
import { PublicationConflictError } from "./conflicts";
import { MoveOutput, type SourceMove } from "./MoveOutput";
import { manifestRefs } from "./manifest";
import { outputFileSystem } from "./outputFileSystem";
import { prepareOutputValidation } from "./outputValidation";
import { preparePublicationPaths } from "./paths";
import {
  assertPublicationFileUnchanged,
  observePublicationFile,
  planRefs,
  preflightPublication,
  publicationSources,
  removeCommittedObsoleteFiles,
  toObsoleteObservation,
} from "./preflight";
import { publicationOperations } from "./publicationPlan";
import { isPublicationPathReferenced } from "./registeredOutputs";
import type { PublicationPlan, PublicationResult, PublishMediaOptions } from "./types";
import { type WriteArtifact, WriteOutput } from "./WriteOutput";

export const commitPublishedMedia = async <TResult>(
  plan: PublicationPlan,
  options: PublishMediaOptions<TResult>,
): Promise<PublicationResult<TResult>> => {
  const fs = options.fileSystem ?? outputFileSystem;
  const operations = publicationOperations(plan);
  const refs = planRefs(plan);
  const copySources = operations.flatMap((operation) => (operation.kind === "copy" ? [operation.sourcePath] : []));
  const paths = await preparePublicationPaths(refs, options, copySources);
  const lockKeys = [...new Set([...refs.map(paths.key), ...copySources.map(paths.pathKey)])];
  let release: () => void;
  try {
    release = options.acquireAll?.(lockKeys) ?? mediaPathOwnership.acquireAll(lockKeys);
  } catch (error) {
    if (error instanceof MediaPathBusyError)
      throw new PublicationConflictError(error.path, error.path, "发布路径正被其他并发任务占用");
    throw error;
  }
  try {
    for (const record of options.journal.listUnfinished()) {
      await paths.prepare(manifestRefs(record.manifest));
      if (manifestRefs(record.manifest).some((ref) => lockKeys.includes(paths.key(ref))))
        throw new PublicationConflictError(
          plan.operationId,
          record.operationId,
          "目标路径存在未完成的移动，请先恢复或清理",
        );
    }
    await options.validate?.();
    const resolved = await preflightPublication(plan, paths, fs);
    const validation = await prepareOutputValidation(plan, options, paths, resolved.observed);
    const moves: SourceMove[] = [];
    const artifacts: WriteArtifact[] = [];
    for (const operation of operations) {
      const targetPath = resolved.resolve(operation.target);
      if (operation.kind === "move") {
        const sourcePath = resolved.resolve(operation.source);
        if (sourcePath === targetPath) continue;
        const observed = resolved.observed.find((file) => file.path === sourcePath);
        if (!observed?.exists) throw new Error(`Publication source is missing: ${sourcePath}`);
        const entry = await lstat(sourcePath);
        if (entry.isSymbolicLink()) {
          const linkTarget = await readlink(sourcePath);
          if (!path.isAbsolute(linkTarget) && path.dirname(sourcePath) !== path.dirname(targetPath))
            throw new Error(`Cannot relocate a relative file symlink without preserving its target: ${sourcePath}`);
          const targetParent = await stat(path.dirname(targetPath)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (!targetParent || (await stat(path.dirname(sourcePath))).dev !== targetParent.dev)
            throw new Error(`Cannot copy a file symlink as source media: ${sourcePath}`);
        }
        moves.push({
          source: operation.source,
          target: operation.target,
          sourcePath,
          targetPath,
          size: operation.size,
          mtimeMs: observed.mtimeMs,
        });
        continue;
      }
      if (operation.kind === "copy") {
        if (operation.sourcePath !== targetPath)
          artifacts.push({
            targetPath,
            sourcePath: operation.sourcePath,
            size: operation.size,
            consume: operation.consume,
          });
        continue;
      }
      const rewritten = plan.files.find(
        (file) =>
          paths.key(file.source) !== paths.key(file.target) && paths.key(file.target) === paths.key(operation.target),
      );
      if (rewritten) {
        const sourcePath = resolved.resolve(rewritten.source);
        const observed = resolved.observed.find((file) => file.path === sourcePath);
        if (!observed?.exists) throw new Error(`Publication source is missing: ${sourcePath}`);
        moves.push({
          source: rewritten.source,
          target: operation.target,
          sourcePath,
          targetPath,
          size: rewritten.sourceSize,
          mtimeMs: observed.mtimeMs,
          rewrittenContent: operation.content.data,
        });
        continue;
      }
      const observed = resolved.observed.find((file) => file.path === targetPath);
      if (!observed?.exists || operation.replaceExisting) artifacts.push({ targetPath, data: operation.content.data });
    }
    for (const [index, artifact] of artifacts.entries()) {
      if (!("sourcePath" in artifact) || !artifact.consume) continue;
      if (artifacts.slice(index + 1).some((next) => "sourcePath" in next && next.sourcePath === artifact.sourcePath))
        artifact.consume = false;
    }
    const validate = async () => {
      for (const media of publicationSources(plan)) {
        const sourcePath = resolved.resolve(media.source);
        const observed = resolved.observed.find((file) => file.path === sourcePath);
        if (observed) assertPublicationFileUnchanged(observed, await observePublicationFile(fs, sourcePath));
      }
      validation?.assertCurrent();
    };
    const commit = () => {
      validation?.assertCurrent();
      return options.commit();
    };
    const result = moves.length
      ? await new MoveOutput(fs).install({
          operationId: plan.operationId,
          operationType: plan.operationType,
          moves,
          artifacts,
          journal: options.journal,
          validate,
          commit,
        })
      : await new WriteOutput(fs).install(artifacts, { validate, commit });
    const obsolete = (validation?.obsolete ?? plan.obsolete)
      .filter((ref) => !moves.some((move) => paths.key(move.source) === paths.key(ref)))
      .map((ref) => {
        const observed = resolved.observed.find((file) => file.path === resolved.resolve(ref));
        if (!observed) throw new Error("Obsolete artifact was not observed");
        return { ...ref, observed: toObsoleteObservation(observed) };
      });
    try {
      const outputs = options.outputs;
      const retained = await removeCommittedObsoleteFiles(
        fs,
        obsolete,
        (rootId, relativePath) => resolved.resolve({ rootId, relativePath }),
        outputs ? (ref) => isPublicationPathReferenced(ref, outputs, options.resolveRoot) : undefined,
      );
      for (const ref of retained) {
        const issue = new Error(
          `Publication obsolete path changed or remains referenced: ${ref.rootId}:${ref.relativePath}`,
        );
        result.cleanupIssues.push(issue);
        await options.repairIssues?.record({
          operationId: plan.operationId,
          operationType: plan.operationType,
          ...ref,
          errorMessage: issue.message,
        });
      }
    } catch (error) {
      result.cleanupIssues.push(error);
    }
    return result;
  } finally {
    release();
  }
};
