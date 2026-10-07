import { resolve } from "node:path";
import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
import { Website } from "@mdcz/shared/enums";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
import type { CrawlerData, FileInfo } from "@mdcz/shared/types";

export const createOrganizerFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  filePath: "/input/ABC-123.mp4",
  fileName: "ABC-123",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
  ...overrides,
});

export const createOrganizerCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

export interface OrganizerConfigOverrides {
  paths?: Partial<typeof defaultConfiguration.paths>;
  naming?: Partial<typeof defaultConfiguration.naming>;
  download?: Partial<typeof defaultConfiguration.download>;
  target?: Partial<PublicationTarget>;
}

/** Settings plus the library layout they publish into: by default a move into `/media/output/{actor}/{number}`. */
export const createOrganizerConfig = (overrides: OrganizerConfigOverrides = {}): [Configuration, PublicationTarget] => [
  configurationSchema.parse({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, ...overrides.paths },
    naming: { ...defaultConfiguration.naming, censoredStyle: "-CEN", ...overrides.naming },
    download: { ...defaultConfiguration.download, ...overrides.download },
  }),
  {
    placement: "move",
    outputPath: resolve("/media/output"),
    folderTemplate: "{actor}/{number}",
    fileTemplate: "{number}",
    ...overrides.target,
  },
];
