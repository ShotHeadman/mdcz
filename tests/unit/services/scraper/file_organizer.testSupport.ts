import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { Website } from "@mdcz/shared/enums";
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
  behavior?: Partial<typeof defaultConfiguration.behavior>;
  download?: Partial<typeof defaultConfiguration.download>;
}

export const createOrganizerConfig = (overrides: OrganizerConfigOverrides = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      mediaPath: "/media",
      successOutputFolder: "output",
      ...overrides.paths,
    },
    naming: {
      ...defaultConfiguration.naming,
      censoredStyle: "-CEN",
      ...overrides.naming,
    },
    behavior: {
      ...defaultConfiguration.behavior,
      ...overrides.behavior,
    },
    download: {
      ...defaultConfiguration.download,
      ...overrides.download,
    },
  });
