import { type Configuration, configManager } from "@main/services/config";
import {
  ActorImageService,
  type CreateFileScraperOptions,
  type FileScrapeOptions,
  type FileScrapeProgress,
  FileScraper,
  type FileScraperDependencies,
  type ScrapeGroupResult,
} from "@mdcz/runtime/scrape";
import { vi } from "vitest";
import { FileOrganizer, type OrganizePlan } from "../../packages/runtime/src/scrape/FileOrganizer";

type TestFileScraperDependencies = Omit<
  FileScraperDependencies,
  "actorImageService" | "getConfiguration" | "logger" | "signalService"
> &
  Partial<Pick<FileScraperDependencies, "actorImageService" | "getConfiguration" | "logger" | "signalService">>;

export const createFileScraper = (
  deps: TestFileScraperDependencies,
  options: CreateFileScraperOptions = {},
): FileScraper => {
  const logger = deps.logger ?? console;
  return new FileScraper(
    {
      ...deps,
      actorImageService:
        deps.actorImageService ??
        new ActorImageService({
          cacheRoot: "/tmp/actor-image-cache",
          logger: "debug" in logger ? logger : { ...logger, debug: () => undefined },
        }),
      getConfiguration: deps.getConfiguration ?? (async () => await configManager.getValidated()),
      logger,
      signalService: deps.signalService ?? {
        setProgress: () => {},
        showLogText: () => {},
        showScrapeInfo: () => {},
        showFailedInfo: () => {},
      },
    },
    options,
  );
};

const getByPath = (target: Record<string, unknown>, path: string): unknown => {
  let cursor: unknown = target;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

export const mockConfigManager = (config: Configuration): void => {
  const ensureLoadedSpy = vi.isMockFunction(configManager.ensureLoaded)
    ? vi.mocked(configManager.ensureLoaded)
    : vi.spyOn(configManager, "ensureLoaded");
  ensureLoadedSpy.mockResolvedValue(undefined);

  const getSpy = vi.isMockFunction(configManager.get) ? vi.mocked(configManager.get) : vi.spyOn(configManager, "get");
  getSpy.mockImplementation(async (path?: string) => {
    if (!path) {
      return config;
    }

    return getByPath(config as unknown as Record<string, unknown>, path);
  });
};

const testFileOrganizer = new FileOrganizer();
export const resolveTestOutputPlan = (
  plan: OrganizePlan,
  sourcePath: string,
  options?: Parameters<FileOrganizer["resolveOutputPlan"]>[2],
) => testFileOrganizer.resolveOutputPlan(plan, sourcePath, options);

export const preparedPublicationFiles = (group: ScrapeGroupResult) => [
  ...(group.output?.files.map((file) => {
    const facts = file.scrape;
    if (!facts) throw new Error("Scrape publication has no prepared facts");
    return {
      ...facts.identity,
      fileId: facts.itemId,
      status: "prepared" as const,
      ...group.output?.scrape,
      videoMeta: file.scrape?.videoMeta,
      output: file.target,
      assets: [...(group.output?.movieAssets ?? []), ...file.assets],
      error: file.scrape?.error,
      uncensoredAmbiguous: file.scrape?.uncensoredAmbiguous,
    };
  }) ?? []),
  ...group.results,
];

export const prepareFile = async (
  scraper: FileScraper,
  filePath: string,
  progress?: FileScrapeProgress,
  signal?: AbortSignal,
  options: FileScrapeOptions = {},
) => scraper.prepareGroup([{ filePath, progress, options }], signal);

export const prepareFilePublication = async (
  scraper: FileScraper,
  ...args: Parameters<typeof prepareFile> extends [FileScraper, ...infer Args] ? Args : never
): Promise<ScrapeGroupResult> => {
  const preparation = await prepareFile(scraper, ...args);
  if (preparation.status !== "prepared") return { results: [preparation] };
  return await scraper.executePreparedFiles(preparation.prepared, args[2]);
};
