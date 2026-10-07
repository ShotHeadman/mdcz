import path from "node:path";
import { filesystemPathKey, isPathInside } from "@mdcz/media-store";
import type { MediaLibraryRecord, MediaLibraryRepository, MediaLibraryValues } from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import {
  AUTOMATION_LEVELS,
  DISCOVERY_MODES,
  type MediaLibraryDto,
  type MediaLibrarySettingsInput,
  mediaLibrarySettingsSchema,
  normalizeCloudPath,
  PLACEMENT_MODES,
  type PublicationTarget,
} from "@mdcz/shared/mediaLibrary";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import { z } from "zod";
import type { LegacyConfigurationConversion } from "../config/legacyLibrary";
import { assertTargetLayout, FileOrganizer } from "../scrape/FileOrganizer";
import type { ConfiguredMediaRootService } from "./mediaRootService";

const recordSchema = z.object({
  placement: z.enum(PLACEMENT_MODES),
  automation: z.enum(AUTOMATION_LEVELS),
  discovery: z.enum(DISCOVERY_MODES),
});

export type MediaLibrary = Omit<MediaLibraryRecord, "placement" | "automation" | "discovery"> &
  z.infer<typeof recordSchema>;

/** Stored values are text; reading them back checks they are still values this version knows. */
export const toMediaLibrary = (record: MediaLibraryRecord): MediaLibrary => ({
  ...record,
  ...recordSchema.parse(record),
});

export const toPublicationTarget = (record: MediaLibraryRecord): PublicationTarget => {
  const { placement } = toMediaLibrary(record);
  return {
    placement,
    outputPath: record.outputPath,
    folderTemplate: record.folderTemplate,
    fileTemplate: record.fileTemplate,
  };
};

export const toMediaLibraryDto = (record: MediaLibraryRecord): MediaLibraryDto => ({
  ...toMediaLibrary(record),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const preview = new FileOrganizer();

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

  /** Creates the library the old single-directory settings described, unless one already uses that directory. */
  async adoptLegacyConfiguration(conversion: LegacyConfigurationConversion): Promise<MediaLibrary | undefined> {
    const library = conversion.library;
    if (!library) return undefined;
    const key = filesystemPathKey(path.resolve(library.sourcePath));
    const existing = (await this.list()).find(
      (candidate) => filesystemPathKey(path.resolve(candidate.sourcePath)) === key,
    );
    if (existing) return existing;
    return toMediaLibrary((await this.repository()).create(mediaLibrarySettingsSchema.parse(library)));
  }

  private async validate(input: MediaLibrarySettingsInput, id?: string): Promise<MediaLibraryValues> {
    const settings = mediaLibrarySettingsSchema.parse(input);
    assertTargetLayout(await this.getConfiguration(), settings);
    for (const other of await this.list()) {
      if (other.id === id) continue;
      if (isPathInside(other.sourcePath, settings.sourcePath) || isPathInside(settings.sourcePath, other.sourcePath))
        throw new Error(`The source directory overlaps library "${other.name}"`);
    }
    // Registering the directories as media roots checks they exist and are reachable now, not at the first scrape.
    await this.mediaRoots.ensurePathRecord({ hostPath: settings.sourcePath });
    if (settings.placement !== "inPlace")
      await this.mediaRoots.prepareOutputDirectory({ hostPath: settings.outputPath });
    return {
      ...settings,
      outputPath: settings.placement === "inPlace" ? "" : settings.outputPath,
      cloudPath: settings.discovery === "clouddrive" ? normalizeCloudPath(settings.cloudPath) : "",
    };
  }
}
