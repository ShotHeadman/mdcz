import path from "node:path";
import { filesystemPathKey, isPathInside } from "@mdcz/media-store";
import type { MediaLibraryRecord, MediaLibraryRepository, MediaLibraryValues } from "@mdcz/persistence";
import { ASSET_NAMING_MODES, NFO_NAMING_MODES } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import {
  AUTOMATION_LEVELS,
  DISCOVERY_MODES,
  type MediaLibraryDto,
  type MediaLibrarySettingsInput,
  type MovieNaming,
  mediaLibrarySettingsSchema,
  type NamingPolicy,
  normalizeCloudPath,
  PLACEMENT_MODES,
  type PublicationTarget,
  resolveMovieNaming,
} from "@mdcz/shared/mediaLibrary";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import { z } from "zod";
import type { LegacyConfigurationConversion } from "../config/legacyLibrary";
import { assertSymlinkSupport } from "../publication/outputFileSystem";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { FileOrganizer } from "../scrape/FileOrganizer";
import type { ConfiguredMediaRootService } from "./mediaRootService";

const recordSchema = z.object({
  placement: z.enum(PLACEMENT_MODES),
  assetNaming: z.enum(ASSET_NAMING_MODES),
  nfoNaming: z.enum(NFO_NAMING_MODES),
  automation: z.enum(AUTOMATION_LEVELS),
  discovery: z.enum(DISCOVERY_MODES),
});

export type MediaLibrary = Omit<
  MediaLibraryRecord,
  "placement" | "assetNaming" | "nfoNaming" | "automation" | "discovery"
> &
  z.infer<typeof recordSchema>;

/** Stored values are text; reading them back checks they are still values this version knows. */
export const toMediaLibrary = (record: MediaLibraryRecord): MediaLibrary => ({
  ...record,
  ...recordSchema.parse(record),
});

export const toPublicationTarget = (record: MediaLibraryRecord): PublicationTarget => {
  const { placement, assetNaming, nfoNaming } = toMediaLibrary(record);
  return {
    placement,
    outputPath: record.outputPath,
    folderTemplate: record.folderTemplate,
    fileTemplate: record.fileTemplate,
    assetNaming,
    nfoNaming,
  };
};

/**
 * The naming policy of the library a movie at `hostPath` belongs to: the one whose source or output directory most
 * closely contains it. Libraries may share an output directory; at the same depth they must name movies alike, or the
 * movie has no single policy and writing it fails.
 */
export const findNamingPolicy = (
  records: readonly MediaLibraryRecord[],
  hostPath: string,
): NamingPolicy | undefined => {
  const owners = records.flatMap((record) =>
    [record.sourcePath, record.outputPath]
      .filter((root) => root && isPathInside(root, hostPath))
      .map((root) => ({ record, depth: path.resolve(root).length })),
  );
  const depth = Math.max(...owners.map((owner) => owner.depth));
  const closest = [
    ...new Map(owners.filter((owner) => owner.depth === depth).map(({ record }) => [record.id, record])).values(),
  ].map((record) => ({ name: record.name, policy: toPublicationTarget(record) }));
  const namings = new Set(
    closest.map(({ policy }) =>
      JSON.stringify(resolveMovieNaming({ policy, holdsOtherMovies: false, downloadSceneImages: true })),
    ),
  );
  if (namings.size > 1)
    throw new Error(
      `Libraries ${closest.map(({ name }) => `"${name}"`).join(" and ")} both contain ${hostPath} but name its files differently; give them different output directories or the same naming`,
    );
  return closest[0]?.policy;
};

/** The naming of one file written outside a scrape or maintenance run, such as an NFO edit or a poster crop. */
export const resolveFileNaming = async (input: {
  libraries: readonly MediaLibraryRecord[];
  videoPath: string;
  metadataDir: string;
  configuration: Pick<Configuration, "scrape" | "download">;
}): Promise<MovieNaming> =>
  resolveMovieNaming({
    policy: findNamingPolicy(input.libraries, input.videoPath),
    holdsOtherMovies: await new DirectoryInventory().holdsOtherMovies(
      input.metadataDir,
      input.videoPath,
      input.configuration.scrape,
    ),
    downloadSceneImages: input.configuration.download.downloadSceneImages,
  });

export const toMediaLibraryDto = (record: MediaLibraryRecord): MediaLibraryDto => ({
  ...toMediaLibrary(record),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const preview = new FileOrganizer();

export class MediaLibrarySettingsError extends Error {}

export class MediaLibraryService {
  constructor(
    private readonly repository: () => Promise<MediaLibraryRepository>,
    private readonly mediaRoots: ConfiguredMediaRootService,
    private readonly getConfiguration: () => Promise<Configuration>,
  ) {}

  async list(): Promise<MediaLibrary[]> {
    return (await this.repository()).list().map(toMediaLibrary);
  }

  async get(id: string): Promise<MediaLibrary> {
    return toMediaLibrary((await this.repository()).get(id));
  }

  async create(input: MediaLibrarySettingsInput): Promise<MediaLibrary> {
    const values = await this.validate(input);
    return toMediaLibrary((await this.repository()).create(values));
  }

  async update(id: string, input: MediaLibrarySettingsInput): Promise<MediaLibrary> {
    const values = await this.validate(input, id);
    return toMediaLibrary((await this.repository()).update(id, values));
  }

  async delete(id: string): Promise<void> {
    (await this.repository()).delete(id);
  }

  async previewNaming(input: MediaLibrarySettingsInput): Promise<NamingPreviewItem[]> {
    const settings = mediaLibrarySettingsSchema.parse(input);
    return preview.buildNamingPreview(await this.getConfiguration(), settings);
  }

  /** The library whose source directory most closely contains `hostPath`. */
  async findBySourcePath(hostPath: string): Promise<MediaLibrary | undefined> {
    return (await this.list())
      .filter((library) => isPathInside(library.sourcePath, hostPath))
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0];
  }

  /**
   * Creates the library the old single-directory settings described, unless one already uses that directory, and
   * gives existing libraries the naming the configuration used to hold. Both are safe to repeat when startup is
   * interrupted before the converted configuration is saved.
   */
  async adoptLegacyConfiguration(conversion: LegacyConfigurationConversion): Promise<void> {
    const repository = await this.repository();
    if (conversion.naming) repository.setNamingForAll(conversion.naming);
    const library = conversion.library;
    if (!library) return;
    const key = filesystemPathKey(path.resolve(library.sourcePath));
    if (repository.list().some((candidate) => filesystemPathKey(path.resolve(candidate.sourcePath)) === key)) return;
    repository.create(mediaLibrarySettingsSchema.parse(library));
  }

  private async validate(input: MediaLibrarySettingsInput, id?: string): Promise<MediaLibraryValues> {
    const settings = mediaLibrarySettingsSchema.parse(input);
    for (const other of await this.list()) {
      if (other.id === id) continue;
      if (isPathInside(other.sourcePath, settings.sourcePath) || isPathInside(settings.sourcePath, other.sourcePath))
        throw new MediaLibrarySettingsError(`The source directory overlaps library "${other.name}"`);
    }
    // Registering the directories as media roots checks they exist and are reachable now, not at the first scrape.
    await this.mediaRoots.ensurePathRecord({ hostPath: settings.sourcePath });
    if (settings.placement !== "inPlace")
      await this.mediaRoots.prepareOutputDirectory({ hostPath: settings.outputPath });
    if (settings.placement === "symlink") await assertSymlinkSupport(settings.outputPath);
    return {
      ...settings,
      outputPath: settings.placement === "inPlace" ? "" : settings.outputPath,
      cloudPath: settings.discovery === "clouddrive" ? normalizeCloudPath(settings.cloudPath) : "",
    };
  }
}
