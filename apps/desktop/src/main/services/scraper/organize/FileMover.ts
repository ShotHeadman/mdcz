import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, normalize, resolve } from "node:path";
import { toErrorMessage } from "@main/utils/common";
import { moveFileSafely, pathExists } from "@main/utils/file";
import { inspectStrmTarget, isStrmFile, writeStrmTarget } from "@main/utils/strm";
import {
  buildGeneratedVideoSidecarTargetPath,
  buildSubtitleSidecarTargetPath,
  type SubtitleSidecarMatch,
} from "../media";
import type { SidecarResolver } from "./SidecarResolver";

interface OrganizeLogger {
  info(message: string): void;
}

type MovedArtifact = {
  sourcePath: string;
  targetPath: string;
  label: string;
};

export class FileMover {
  constructor(
    private readonly logger: OrganizeLogger,
    private readonly sidecarResolver: SidecarResolver,
  ) {}

  async moveBundledMedia(
    sourceVideoPath: string,
    targetVideoPath: string,
    options: {
      subtitleSidecars?: SubtitleSidecarMatch[];
      sharedMovieBaseName: string;
    },
  ): Promise<string> {
    const sidecars = await this.sidecarResolver.resolve(sourceVideoPath, options.subtitleSidecars);
    const movedArtifacts: MovedArtifact[] = [];
    let movedVideoPath: string | undefined;
    let originalStrmContent: string | undefined;
    let rewrittenStrmTarget: string | undefined;

    if (isStrmFile(sourceVideoPath) && resolve(dirname(sourceVideoPath)) !== resolve(dirname(targetVideoPath))) {
      const strmTarget = await inspectStrmTarget(sourceVideoPath);
      if (strmTarget?.kind === "relative_path" && strmTarget.resolvedPath) {
        originalStrmContent = await readFile(sourceVideoPath, "utf8");
        rewrittenStrmTarget = strmTarget.resolvedPath;
      }
    }

    try {
      movedVideoPath = await moveFileSafely(sourceVideoPath, targetVideoPath);
      if (movedVideoPath && rewrittenStrmTarget) {
        await writeStrmTarget(movedVideoPath, rewrittenStrmTarget);
        this.logger.info(`Rewrote relative STRM target to absolute path: ${movedVideoPath}`);
      }

      for (const subtitleSidecar of sidecars.subtitleSidecars) {
        const targetSubtitlePath = buildSubtitleSidecarTargetPath(subtitleSidecar, movedVideoPath);
        const movedSubtitlePath = await moveFileSafely(subtitleSidecar.path, targetSubtitlePath);
        movedArtifacts.push({
          sourcePath: subtitleSidecar.path,
          targetPath: movedSubtitlePath,
          label: "subtitle",
        });
        this.logger.info(`Moved subtitle sidecar to ${movedSubtitlePath}`);
      }

      for (const generatedVideoSidecar of sidecars.generatedVideoSidecars) {
        const targetSidecarPath = buildGeneratedVideoSidecarTargetPath(
          generatedVideoSidecar,
          dirname(movedVideoPath),
          options.sharedMovieBaseName,
        );
        const movedSidecarPath = await moveFileSafely(generatedVideoSidecar.path, targetSidecarPath);
        movedArtifacts.push({
          sourcePath: generatedVideoSidecar.path,
          targetPath: movedSidecarPath,
          label: "generated sidecar",
        });
        this.logger.info(`Moved generated video sidecar to ${movedSidecarPath}`);
      }

      return movedVideoPath;
    } catch (error) {
      const rollbackErrors = await this.rollbackMovedArtifacts(
        movedArtifacts,
        movedVideoPath,
        sourceVideoPath,
        originalStrmContent,
      );
      const message = toErrorMessage(error);
      if (rollbackErrors.length > 0) {
        throw new Error(`Failed to move bundled media: ${message}. Rollback failed: ${rollbackErrors.join("; ")}`);
      }

      throw new Error(`Failed to move bundled media: ${message}`);
    }
  }

  async cleanupEmptyAncestors(dirPath: string, stopAt: string): Promise<void> {
    const normalizedStop = normalize(resolve(stopAt));
    let current = normalize(resolve(dirPath));

    while (current.length > normalizedStop.length && current.startsWith(normalizedStop)) {
      try {
        const entries = await readdir(current);
        if (entries.length > 0) {
          break;
        }
        await rm(current, { recursive: true });
        this.logger.info(`Deleted empty folder: ${current}`);
        current = dirname(current);
      } catch {
        break;
      }
    }
  }

  private async rollbackMovedArtifacts(
    movedArtifacts: MovedArtifact[],
    movedVideoPath: string | undefined,
    sourceVideoPath: string,
    originalVideoContent?: string,
  ): Promise<string[]> {
    const rollbackErrors: string[] = [];

    for (const artifact of movedArtifacts.reverse()) {
      try {
        await moveFileSafely(artifact.targetPath, artifact.sourcePath);
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        rollbackErrors.push(`${artifact.label} ${artifact.targetPath}: ${rollbackMessage}`);
      }
    }

    if (movedVideoPath && (await pathExists(movedVideoPath))) {
      if (originalVideoContent !== undefined) {
        try {
          await writeFile(movedVideoPath, originalVideoContent, "utf8");
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          rollbackErrors.push(`video content ${movedVideoPath}: ${rollbackMessage}`);
        }
      }

      try {
        await moveFileSafely(movedVideoPath, sourceVideoPath);
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        rollbackErrors.push(`video ${movedVideoPath}: ${rollbackMessage}`);
      }
    }

    return rollbackErrors;
  }
}
