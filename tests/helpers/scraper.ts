import { dirname, join } from "node:path";
import {
  ActorImageService,
  type CreateFileScraperOptions,
  type FileScrapeOptions,
  type FileScrapeProgress,
  FileScraper,
  type FileScraperDependencies,
  type ScrapeGroupResult,
} from "@mdcz/runtime/scrape";
import { defaultConfiguration } from "@mdcz/shared/config";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
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
      getConfiguration: deps.getConfiguration ?? (async () => defaultConfiguration),
      logger,
      signalService: deps.signalService ?? {
        setProgress: () => {},
        showLogText: () => {},
        showScrapeStep: () => {},
        showFailedInfo: () => {},
      },
    },
    options,
  );
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
    };
  }) ?? []),
  ...group.results,
];

/** The default library layout: move into `JAV_output/{actor}/{number}` beside the source. */
export const testPublicationTarget = (
  filePath: string,
  overrides: Partial<PublicationTarget> = {},
): PublicationTarget => ({
  placement: "move",
  outputPath: join(dirname(filePath), "JAV_output"),
  folderTemplate: "{actor}/{number}",
  fileTemplate: "{number}",
  ...overrides,
});

export const prepareFile = async (
  scraper: FileScraper,
  filePath: string,
  progress?: FileScrapeProgress,
  signal?: AbortSignal,
  options: Partial<FileScrapeOptions> = {},
) =>
  scraper.prepareGroup(
    [{ filePath, progress, options: { ...options, target: options.target ?? testPublicationTarget(filePath) } }],
    signal,
  );

export const prepareFilePublication = async (
  scraper: FileScraper,
  ...args: Parameters<typeof prepareFile> extends [FileScraper, ...infer Args] ? Args : never
): Promise<ScrapeGroupResult> => {
  const preparation = await prepareFile(scraper, ...args);
  if (preparation.status !== "prepared") return { results: [preparation] };
  return await scraper.executePreparedFiles(preparation.prepared, args[2]);
};
