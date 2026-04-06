import { stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { pathExists } from "@main/utils/file";
import { buildSubtitleSidecarTargetPath, type SubtitleSidecarMatch } from "../media";
import type { SidecarResolver } from "./SidecarResolver";

export class PathPlanner {
  constructor(private readonly sidecarResolver: SidecarResolver) {}

  async resolveBundledTargetPaths(options: {
    sourceVideoPath: string;
    targetVideoPath: string;
    nfoPath?: string;
    ignoreExistingNfoAtTarget?: boolean;
    subtitleSidecars?: SubtitleSidecarMatch[];
  }): Promise<{
    targetVideoPath: string;
    nfoPath?: string;
    subtitleSidecars: SubtitleSidecarMatch[];
  }> {
    const subtitleSidecars = await this.sidecarResolver.resolveSubtitleSidecars(
      options.sourceVideoPath,
      options.subtitleSidecars,
    );
    const ignoredExistingPaths = new Set<string>([
      resolve(options.sourceVideoPath),
      ...subtitleSidecars.map((subtitleSidecar) => resolve(subtitleSidecar.path)),
    ]);
    if (options.ignoreExistingNfoAtTarget && options.nfoPath) {
      ignoredExistingPaths.add(resolve(options.nfoPath));
    }

    const parsedTargetVideo = parse(options.targetVideoPath);
    const parsedNfo = options.nfoPath ? parse(options.nfoPath) : undefined;
    const nfoTracksVideoBase = parsedNfo ? parsedNfo.name === parsedTargetVideo.name : false;
    const sharedMultipartNfo = Boolean(parsedNfo && !nfoTracksVideoBase);
    let collisionSuffix = 0;

    while (true) {
      const candidateBaseName =
        collisionSuffix === 0 ? parsedTargetVideo.name : `${parsedTargetVideo.name} (${collisionSuffix})`;
      const candidateVideoPath = join(parsedTargetVideo.dir, `${candidateBaseName}${parsedTargetVideo.ext}`);
      const candidateNfoPath = parsedNfo
        ? join(parsedNfo.dir, `${nfoTracksVideoBase ? candidateBaseName : parsedNfo.name}${parsedNfo.ext}`)
        : undefined;
      const candidatePaths = [
        candidateVideoPath,
        ...subtitleSidecars.map((subtitleSidecar) =>
          buildSubtitleSidecarTargetPath(subtitleSidecar, candidateVideoPath),
        ),
        ...(candidateNfoPath && !sharedMultipartNfo ? [candidateNfoPath] : []),
      ];
      const hasCollision = (
        await Promise.all(candidatePaths.map((targetPath) => this.hasTargetCollision(targetPath, ignoredExistingPaths)))
      ).some(Boolean);

      if (!hasCollision) {
        return {
          targetVideoPath: candidateVideoPath,
          nfoPath: candidateNfoPath,
          subtitleSidecars,
        };
      }

      collisionSuffix += 1;
    }
  }

  async resolveExistingDirectory(dirPath: string): Promise<string> {
    let current = resolve(dirPath);

    while (true) {
      try {
        const info = await stat(current);
        if (info.isDirectory()) {
          return current;
        }
      } catch {
        // Keep walking up to the nearest existing directory.
      }

      const parent = dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }

  private async hasTargetCollision(targetPath: string, ignoredExistingPaths: Set<string>): Promise<boolean> {
    if (!(await pathExists(targetPath))) {
      return false;
    }

    return !ignoredExistingPaths.has(resolve(targetPath));
  }
}
