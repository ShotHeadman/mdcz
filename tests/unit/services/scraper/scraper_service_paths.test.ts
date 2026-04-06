import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Configuration } from "@main/services/config";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import type { ScraperMode } from "@main/services/scraper/ScraperService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scraper-service-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createService = (): ScraperService => {
  const signalService = new SignalService(null);
  const networkClient = new NetworkClient();
  const crawlerProvider = new CrawlerProvider({
    fetchGateway: new FetchGateway(networkClient),
  });
  return new ScraperService(signalService, networkClient, crawlerProvider);
};

const resolveFilePaths = async (
  service: ScraperService,
  mode: ScraperMode,
  paths: string[],
  configuration: Configuration,
): Promise<string[]> =>
  await (
    service as unknown as {
      resolveFilePaths: (mode: ScraperMode, paths: string[], configuration: Configuration) => Promise<string[]>;
    }
  ).resolveFilePaths(mode, paths, configuration);

describe("ScraperService path filtering", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("excludes output directory videos discovered through a softlink path", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const outputDir = join(mediaRoot, "JAV_output");
    const libraryDir = join(mediaRoot, "library");
    const softlinkRoot = join(root, "softlink");
    const keepVideoPath = join(libraryDir, "ABC-123.mp4");
    const outputVideoPath = join(outputDir, "XYZ-999.mp4");
    const softlinkOutputDir = join(softlinkRoot, "JAV_output");

    await mkdir(outputDir, { recursive: true });
    await mkdir(libraryDir, { recursive: true });
    await mkdir(softlinkRoot, { recursive: true });
    await writeFile(keepVideoPath, "", "utf8");
    await writeFile(outputVideoPath, "", "utf8");
    await symlink(outputDir, softlinkOutputDir, process.platform === "win32" ? "junction" : "dir");

    const configuration = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: mediaRoot,
        softlinkPath: softlinkRoot,
        successOutputFolder: "JAV_output",
      },
      behavior: {
        ...defaultConfiguration.behavior,
        scrapeSoftlinkPath: true,
      },
    });

    const filePaths = await resolveFilePaths(createService(), "batch", [mediaRoot], configuration);

    expect(filePaths).toEqual([keepVideoPath]);
  });

  it("excludes videos inside an absolute success output directory", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const outputDir = join(mediaRoot, "custom-output");
    const libraryDir = join(mediaRoot, "library");
    const keepVideoPath = join(libraryDir, "ABC-123.mp4");
    const outputVideoPath = join(outputDir, "XYZ-999.mp4");

    await mkdir(outputDir, { recursive: true });
    await mkdir(libraryDir, { recursive: true });
    await writeFile(keepVideoPath, "", "utf8");
    await writeFile(outputVideoPath, "", "utf8");

    const configuration = configurationSchema.parse({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: mediaRoot,
        successOutputFolder: outputDir,
      },
    });

    const filePaths = await resolveFilePaths(createService(), "batch", [mediaRoot], configuration);

    expect(filePaths).toEqual([keepVideoPath]);
  });
});
