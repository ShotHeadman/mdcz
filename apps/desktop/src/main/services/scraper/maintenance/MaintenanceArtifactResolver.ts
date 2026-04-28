import { unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { moveFileSafely, pathExists } from "@main/utils/file";
import type { DiscoveredAssets, LocalScanEntry, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import type { OrganizePlan } from "../FileOrganizer";
import { reconcileExistingNfoFiles, resolveCanonicalNfoPath } from "../NfoGenerator";

interface ResolvedMaintenanceArtifacts {
  nfoPath?: string;
  assets: DiscoveredAssets;
}

type PreferredMaintenanceAssets = Pick<DiscoveredAssets, "thumb" | "poster" | "fanart" | "sceneImages" | "trailer">;

export class MaintenanceArtifactResolver {
  private readonly logger = loggerService.getLogger("MaintenanceArtifactResolver");

  async resolve(input: {
    entry: LocalScanEntry;
    plan?: OrganizePlan;
    outputVideoPath: string;
    preferredAssets?: PreferredMaintenanceAssets;
    savedNfoPath?: string;
    preparedActorPhotoPaths?: string[];
    assetDecisions?: MaintenanceAssetDecisions;
    nfoNaming?: "both" | "movie" | "filename";
  }): Promise<ResolvedMaintenanceArtifacts> {
    const preferredAssets = input.preferredAssets ?? { sceneImages: [] };

    if (!input.plan) {
      const nfoPath = input.savedNfoPath ?? input.entry.nfoPath;
      return {
        nfoPath,
        assets: {
          thumb: preferredAssets.thumb,
          poster: preferredAssets.poster,
          fanart: preferredAssets.fanart,
          sceneImages: preferredAssets.sceneImages,
          trailer: preferredAssets.trailer,
          actorPhotos:
            (input.preparedActorPhotoPaths?.length ?? 0) > 0
              ? (input.preparedActorPhotoPaths ?? [])
              : input.entry.assets.actorPhotos,
        },
      };
    }

    const outputDir = dirname(input.outputVideoPath);
    const nfoPath = await this.resolveNfoPath(input.entry, input.plan, input.savedNfoPath, input.nfoNaming);

    return {
      nfoPath,
      assets: {
        thumb: await this.resolvePrimaryAsset(input.entry.assets.thumb, preferredAssets.thumb, outputDir),
        poster: await this.resolvePrimaryAsset(input.entry.assets.poster, preferredAssets.poster, outputDir),
        fanart: await this.resolvePrimaryAsset(input.entry.assets.fanart, preferredAssets.fanart, outputDir),
        sceneImages: await this.resolveAssetCollection(
          input.entry.assets.sceneImages,
          preferredAssets.sceneImages,
          outputDir,
        ),
        trailer: await this.resolvePrimaryAsset(input.entry.assets.trailer, preferredAssets.trailer, outputDir, {
          discardExisting: input.assetDecisions?.trailer === "replace" && !preferredAssets.trailer,
        }),
        actorPhotos: await this.resolveAssetCollection(
          input.entry.assets.actorPhotos,
          input.preparedActorPhotoPaths ?? [],
          outputDir,
        ),
      },
    };
  }

  private async resolveNfoPath(
    entry: LocalScanEntry,
    plan: OrganizePlan,
    savedNfoPath?: string,
    nfoNaming: "both" | "movie" | "filename" = "both",
  ): Promise<string | undefined> {
    if (savedNfoPath) {
      await this.removeStaleOriginalNfo(entry.nfoPath, savedNfoPath);
      return savedNfoPath;
    }

    const targetNfoPath = resolveCanonicalNfoPath(plan.nfoPath, nfoNaming);
    const movedNfoPath = await this.moveKnownAsset(entry.nfoPath, targetNfoPath);
    if (!movedNfoPath) {
      return undefined;
    }
    await this.removeStaleOriginalNfo(entry.nfoPath, movedNfoPath);
    return await reconcileExistingNfoFiles(plan.nfoPath, nfoNaming);
  }

  private async resolvePrimaryAsset(
    sourcePath: string | undefined,
    preferredPath: string | undefined,
    outputDir: string,
    options: {
      discardExisting?: boolean;
    } = {},
  ): Promise<string | undefined> {
    const candidatePath = preferredPath ?? sourcePath;
    if (!candidatePath) {
      return undefined;
    }

    const targetPath = join(outputDir, basename(candidatePath));

    if (preferredPath) {
      const resolvedPreferredPath = await this.moveKnownAsset(preferredPath, targetPath);
      await this.removeStaleSourceAsset(sourcePath, resolvedPreferredPath);
      return resolvedPreferredPath;
    }

    if (!sourcePath) {
      return undefined;
    }

    if (options.discardExisting) {
      await this.removeKnownAsset(sourcePath, targetPath);
      return undefined;
    }

    return await this.moveKnownAsset(sourcePath, targetPath);
  }

  private async resolveAssetCollection(
    sourcePaths: string[],
    preferredPaths: string[],
    outputDir: string,
  ): Promise<string[]> {
    if (preferredPaths.length > 0) {
      const resolvedPreferredPaths: string[] = [];
      const seen = new Set<string>();

      for (const preferredPath of preferredPaths) {
        const targetPath = join(outputDir, basename(dirname(preferredPath)), basename(preferredPath));
        const resolvedPreferredPath = await this.moveKnownAsset(preferredPath, targetPath);
        if (!resolvedPreferredPath || seen.has(resolvedPreferredPath)) {
          continue;
        }

        seen.add(resolvedPreferredPath);
        resolvedPreferredPaths.push(resolvedPreferredPath);
      }

      await this.removeStaleCollectionAssets(sourcePaths, resolvedPreferredPaths);
      return resolvedPreferredPaths;
    }

    const resolved: string[] = [];
    for (const sourcePath of sourcePaths) {
      const targetPath = join(outputDir, basename(dirname(sourcePath)), basename(sourcePath));
      const movedPath = await this.moveKnownAsset(sourcePath, targetPath);
      if (movedPath) {
        resolved.push(movedPath);
      }
    }
    return resolved;
  }

  private async removeStaleSourceAsset(
    sourcePath: string | undefined,
    resolvedPath: string | undefined,
  ): Promise<void> {
    if (!sourcePath || !resolvedPath || sourcePath === resolvedPath || !(await pathExists(sourcePath))) {
      return;
    }

    await unlink(sourcePath).catch(() => undefined);
  }

  private async removeStaleCollectionAssets(sourcePaths: string[], keptPaths: string[]): Promise<void> {
    const keptPathSet = new Set(keptPaths);

    for (const sourcePath of sourcePaths) {
      if (keptPathSet.has(sourcePath) || !(await pathExists(sourcePath))) {
        continue;
      }

      await unlink(sourcePath).catch(() => undefined);
    }
  }

  private async moveKnownAsset(sourcePath: string | undefined, targetPath: string): Promise<string | undefined> {
    if (!sourcePath) {
      return undefined;
    }

    if (sourcePath === targetPath) {
      return (await pathExists(sourcePath)) ? sourcePath : undefined;
    }

    if (!(await pathExists(sourcePath))) {
      return (await pathExists(targetPath)) ? targetPath : undefined;
    }

    if (await pathExists(targetPath)) {
      return targetPath;
    }

    return await moveFileSafely(sourcePath, targetPath);
  }

  private async removeKnownAsset(sourcePath: string | undefined, targetPath: string): Promise<void> {
    const candidates = new Set([sourcePath, targetPath].filter((value): value is string => Boolean(value)));
    for (const filePath of candidates) {
      if (!(await pathExists(filePath))) {
        continue;
      }

      await unlink(filePath).catch(() => undefined);
    }
  }

  private async removeStaleOriginalNfo(originalNfoPath: string | undefined, savedNfoPath: string): Promise<void> {
    if (!originalNfoPath) {
      return;
    }

    const savedMovieNfoPath = join(dirname(savedNfoPath), "movie.nfo");
    const originalMovieNfoPath = join(dirname(originalNfoPath), "movie.nfo");
    const staleCandidates = new Set([originalNfoPath]);
    if (originalMovieNfoPath !== savedMovieNfoPath) {
      staleCandidates.add(originalMovieNfoPath);
    }

    for (const stalePath of staleCandidates) {
      if (stalePath === savedNfoPath || stalePath === savedMovieNfoPath || !(await pathExists(stalePath))) {
        continue;
      }

      try {
        await unlink(stalePath);
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to remove stale NFO ${stalePath}: ${message}`);
      }
    }
  }
}
