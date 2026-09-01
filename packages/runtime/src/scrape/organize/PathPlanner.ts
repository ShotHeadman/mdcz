import { stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import type { SubtitleSidecarMatch } from "../media";
import { pathExists } from "../utils/filesystem";
import type { SidecarResolver } from "./SidecarResolver";

export class PathPlanner {
  constructor(private readonly sidecarResolver: SidecarResolver) {}

  async resolveBundledTargetPaths(options: {
    sourceVideoPath: string;
    targetVideoPath: string;
    nfoPath?: string;
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
    const parsedTargetVideo = parse(options.targetVideoPath);
    const parsedNfo = options.nfoPath ? parse(options.nfoPath) : undefined;
    const nfoTracksVideoBase = parsedNfo ? parsedNfo.name === parsedTargetVideo.name : false;
    let collisionSuffix = 0;

    while (true) {
      const candidateBaseName =
        collisionSuffix === 0 ? parsedTargetVideo.name : `${parsedTargetVideo.name} (${collisionSuffix})`;
      const candidateVideoPath = join(parsedTargetVideo.dir, `${candidateBaseName}${parsedTargetVideo.ext}`);
      const candidateNfoPath = parsedNfo
        ? join(parsedNfo.dir, `${nfoTracksVideoBase ? candidateBaseName : parsedNfo.name}${parsedNfo.ext}`)
        : undefined;
      // Artifact targets (NFO, images, subtitles) are reconciled by
      // publication; only an existing video can select a new basename.
      const hasCollision = await this.hasTargetCollision(candidateVideoPath, ignoredExistingPaths);

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
