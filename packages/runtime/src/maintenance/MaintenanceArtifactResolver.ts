import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { DiscoveredAssets, LocalScanEntry, MaintenanceAssetDecisions } from "@mdcz/shared/types";
import { type OrganizePlan, resolveMetadataOutputDir } from "../scrape";
import { reconcileExistingNfoFiles, resolveCanonicalNfoPath } from "../scrape/nfo";
import { moveFileSafely, pathExists } from "../scrape/utils/filesystem";

interface ResolvedMaintenanceArtifacts {
  nfoPath?: string;
  assets: DiscoveredAssets;
}

type PreferredMaintenanceAssets = Pick<DiscoveredAssets, "thumb" | "poster" | "fanart" | "sceneImages" | "trailer">;

interface MaintenanceMoveContext {
  referencedPaths: ReadonlySet<string>;
  stalePaths: Set<string>;
}

const normalizePathKey = (filePath: string): string => resolvePath(filePath);

export class MaintenanceArtifactResolver {
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

    const outputDir = resolveMetadataOutputDir(input.plan);
    const moveContext = this.createMoveContext(input, preferredAssets);
    const assets: DiscoveredAssets = {
      thumb: await this.resolvePrimaryAsset(input.entry.assets.thumb, preferredAssets.thumb, outputDir, moveContext),
      poster: await this.resolvePrimaryAsset(input.entry.assets.poster, preferredAssets.poster, outputDir, moveContext),
      fanart: await this.resolvePrimaryAsset(input.entry.assets.fanart, preferredAssets.fanart, outputDir, moveContext),
      sceneImages: await this.resolveAssetCollection(
        input.entry.assets.sceneImages,
        preferredAssets.sceneImages,
        outputDir,
        moveContext,
      ),
      trailer: await this.resolvePrimaryAsset(
        input.entry.assets.trailer,
        preferredAssets.trailer,
        outputDir,
        moveContext,
        {
          discardExisting: input.assetDecisions?.trailer === "replace" && !preferredAssets.trailer,
        },
      ),
      actorPhotos: await this.resolveAssetCollection(
        input.entry.assets.actorPhotos,
        input.preparedActorPhotoPaths ?? [],
        outputDir,
        moveContext,
      ),
    };
    const nfoPath = await this.resolveNfoPath(
      input.entry,
      input.plan,
      moveContext,
      input.savedNfoPath,
      input.nfoNaming,
    );
    const resolved = { nfoPath, assets };

    await this.cleanupScheduledStalePaths(moveContext.stalePaths, [
      input.outputVideoPath,
      nfoPath,
      assets.thumb,
      assets.poster,
      assets.fanart,
      assets.trailer,
      ...assets.sceneImages,
      ...assets.actorPhotos,
    ]);

    return resolved;
  }

  private createMoveContext(
    input: {
      entry: LocalScanEntry;
      outputVideoPath: string;
      savedNfoPath?: string;
      preparedActorPhotoPaths?: string[];
    },
    preferredAssets: PreferredMaintenanceAssets,
  ): MaintenanceMoveContext {
    const referencedPaths = [
      input.entry.fileInfo.filePath,
      input.entry.nfoPath,
      input.entry.assets.thumb,
      input.entry.assets.poster,
      input.entry.assets.fanart,
      input.entry.assets.trailer,
      ...input.entry.assets.sceneImages,
      ...input.entry.assets.actorPhotos,
      input.outputVideoPath,
      input.savedNfoPath,
      preferredAssets.thumb,
      preferredAssets.poster,
      preferredAssets.fanart,
      preferredAssets.trailer,
      ...preferredAssets.sceneImages,
      ...(input.preparedActorPhotoPaths ?? []),
    ].filter((filePath): filePath is string => Boolean(filePath));

    return {
      referencedPaths: new Set(referencedPaths.map(normalizePathKey)),
      stalePaths: new Set<string>(),
    };
  }

  private async resolveNfoPath(
    entry: LocalScanEntry,
    plan: OrganizePlan,
    moveContext: MaintenanceMoveContext,
    savedNfoPath?: string,
    nfoNaming: "both" | "movie" | "filename" = "both",
  ): Promise<string | undefined> {
    if (savedNfoPath) {
      if (!(await this.statIfExists(savedNfoPath))) {
        throw new Error(`Saved maintenance NFO is missing: ${savedNfoPath}`);
      }
      this.scheduleStaleOriginalNfo(entry.nfoPath, savedNfoPath, moveContext);
      return savedNfoPath;
    }

    const targetNfoPath = resolveCanonicalNfoPath(plan.nfoPath, nfoNaming);
    const movedNfoPath = await this.moveKnownAsset(entry.nfoPath, targetNfoPath, moveContext);
    if (!movedNfoPath) {
      return undefined;
    }
    this.scheduleStaleOriginalNfo(entry.nfoPath, movedNfoPath, moveContext);
    return await reconcileExistingNfoFiles(plan.nfoPath, nfoNaming, pathExists);
  }

  private async resolvePrimaryAsset(
    sourcePath: string | undefined,
    preferredPath: string | undefined,
    outputDir: string,
    moveContext: MaintenanceMoveContext,
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
      const resolvedPreferredPath = await this.moveKnownAsset(preferredPath, targetPath, moveContext);
      if (!resolvedPreferredPath) {
        throw new Error(`Maintenance replacement asset is missing at both ${preferredPath} and ${targetPath}`);
      }
      this.scheduleStaleSourceAsset(sourcePath, resolvedPreferredPath, moveContext);
      return resolvedPreferredPath;
    }

    if (!sourcePath) {
      return undefined;
    }

    if (options.discardExisting) {
      this.scheduleKnownAssetRemoval(sourcePath, targetPath, moveContext);
      return undefined;
    }

    return await this.moveKnownAsset(sourcePath, targetPath, moveContext);
  }

  private async resolveAssetCollection(
    sourcePaths: string[],
    preferredPaths: string[],
    outputDir: string,
    moveContext: MaintenanceMoveContext,
  ): Promise<string[]> {
    if (preferredPaths.length > 0) {
      const resolvedPreferredPaths: string[] = [];
      const seen = new Set<string>();

      for (const preferredPath of preferredPaths) {
        const targetPath = join(outputDir, basename(dirname(preferredPath)), basename(preferredPath));
        const resolvedPreferredPath = await this.moveKnownAsset(preferredPath, targetPath, moveContext);
        if (!resolvedPreferredPath) {
          throw new Error(`Maintenance replacement asset is missing at both ${preferredPath} and ${targetPath}`);
        }
        if (seen.has(resolvedPreferredPath)) {
          continue;
        }

        seen.add(resolvedPreferredPath);
        resolvedPreferredPaths.push(resolvedPreferredPath);
      }

      this.scheduleStaleCollectionAssets(sourcePaths, resolvedPreferredPaths, moveContext);
      return resolvedPreferredPaths;
    }

    const resolved: string[] = [];
    for (const sourcePath of sourcePaths) {
      const targetPath = join(outputDir, basename(dirname(sourcePath)), basename(sourcePath));
      const movedPath = await this.moveKnownAsset(sourcePath, targetPath, moveContext);
      if (movedPath) {
        resolved.push(movedPath);
      }
    }
    return resolved;
  }

  private scheduleStaleSourceAsset(
    sourcePath: string | undefined,
    resolvedPath: string,
    moveContext: MaintenanceMoveContext,
  ): void {
    if (sourcePath && normalizePathKey(sourcePath) !== normalizePathKey(resolvedPath)) {
      moveContext.stalePaths.add(sourcePath);
    }
  }

  private scheduleStaleCollectionAssets(
    sourcePaths: string[],
    keptPaths: string[],
    moveContext: MaintenanceMoveContext,
  ): void {
    const keptPathSet = new Set(keptPaths.map(normalizePathKey));
    for (const sourcePath of sourcePaths) {
      if (!keptPathSet.has(normalizePathKey(sourcePath))) {
        moveContext.stalePaths.add(sourcePath);
      }
    }
  }

  private async moveKnownAsset(
    sourcePath: string | undefined,
    targetPath: string,
    moveContext: MaintenanceMoveContext,
  ): Promise<string | undefined> {
    if (!sourcePath) {
      return undefined;
    }

    const sourceKey = normalizePathKey(sourcePath);
    const targetKey = normalizePathKey(targetPath);
    if (sourceKey === targetKey) {
      return (await this.statIfExists(sourcePath)) ? targetPath : undefined;
    }

    const [sourceStats, targetStats] = await Promise.all([
      this.statIfExists(sourcePath),
      this.statIfExists(targetPath),
    ]);
    if (!sourceStats && !targetStats) {
      return undefined;
    }
    if (sourceStats && !targetStats) {
      return await moveFileSafely(sourcePath, targetPath);
    }
    if (!sourceStats && targetStats) {
      if (moveContext.referencedPaths.has(targetKey)) {
        return targetPath;
      }
      throw new Error(
        `Ambiguous maintenance asset state: source ${sourcePath} is missing while target ${targetPath} exists but is not referenced by the current scan`,
      );
    }

    if (sourceStats?.size !== targetStats?.size) {
      throw new Error(
        `Conflicting maintenance asset copies at ${sourcePath} and ${targetPath}: sizes ${sourceStats?.size} and ${targetStats?.size} differ`,
      );
    }

    const [sourceDigest, targetDigest] = await Promise.all([this.sha256File(sourcePath), this.sha256File(targetPath)]);
    if (sourceDigest !== targetDigest) {
      throw new Error(
        `Conflicting maintenance asset copies at ${sourcePath} and ${targetPath}: SHA-256 digests differ`,
      );
    }

    moveContext.stalePaths.add(sourcePath);
    return targetPath;
  }

  private scheduleKnownAssetRemoval(
    sourcePath: string | undefined,
    targetPath: string,
    moveContext: MaintenanceMoveContext,
  ): void {
    if (sourcePath) {
      moveContext.stalePaths.add(sourcePath);
    }
    moveContext.stalePaths.add(targetPath);
  }

  private scheduleStaleOriginalNfo(
    originalNfoPath: string | undefined,
    savedNfoPath: string,
    moveContext: MaintenanceMoveContext,
  ): void {
    if (!originalNfoPath) {
      return;
    }

    const savedMovieNfoPath = join(dirname(savedNfoPath), "movie.nfo");
    const originalMovieNfoPath = join(dirname(originalNfoPath), "movie.nfo");
    moveContext.stalePaths.add(originalNfoPath);
    if (normalizePathKey(originalMovieNfoPath) !== normalizePathKey(savedMovieNfoPath)) {
      moveContext.stalePaths.add(originalMovieNfoPath);
    }
  }

  private async cleanupScheduledStalePaths(
    stalePaths: ReadonlySet<string>,
    keptPaths: Array<string | undefined>,
  ): Promise<void> {
    const keptPathSet = new Set(
      keptPaths.filter((filePath): filePath is string => Boolean(filePath)).map(normalizePathKey),
    );
    for (const stalePath of stalePaths) {
      if (keptPathSet.has(normalizePathKey(stalePath))) {
        continue;
      }
      try {
        await unlink(stalePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  private async statIfExists(filePath: string): Promise<Stats | undefined> {
    try {
      return await stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  }
}
