import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { RateLimiter } from "@mdcz/runtime/network";
import { NetworkFixtureClient } from "@mdcz/runtime/network/NetworkFixtureClient";
import { attachNetworkFixtureCaseId } from "@mdcz/runtime/network/networkFixtureCase";
import { AggregationService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { MediaLibrarySettingsInput } from "@mdcz/shared/mediaLibrary";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import type { ServerApp } from "./app";
import {
  closeTestServers,
  createTempRoot,
  createTestLibrary,
  createTestServer,
  loginAsAdmin,
  waitForScrapeRunStatus,
} from "./app.testSupport";

type ConfigPatch = Parameters<ServerApp["services"]["config"]["update"]>[0];

interface ReplayScenario {
  name: string;
  /** Files under the scan directory, keyed by path relative to the temp root. */
  files: Record<string, string>;
  config?: ConfigPatch;
  /** Overwrites these files, then scrapes the organized output again as a library refresh does. */
  rescrape?: Record<string, string>;
  /** Applied after the first run, which is then rerun and must pick these settings up. */
  rerunConfig?: ConfigPatch;
  rerunLibrary?: Partial<MediaLibrarySettingsInput>;
  status?: "completed" | "failed";
}

const fixturesRoot = resolve(import.meta.dirname, "../../../tests/fixtures/network");
const hasNetworkFixtures =
  existsSync(fixturesRoot) &&
  existsSync(join(fixturesRoot, "snos-301", "manifest.json"));
const mockMediaRoot = resolve(import.meta.dirname, "../../../tests/fixtures/mock-media");
const recordedThisRun = new Set<string>();
const imageExtensions = new Set([".jpg", ".png", ".webp"]);

const scenarios: ReplayScenario[] = [
  { name: "single file", files: { "source/SNOS-301.mp4": "video" } },
  { name: "split disc", files: { "source/SNOS-301-CD1.mp4": "cd1", "source/SNOS-301-CD2.mp4": "cd2" } },
  {
    name: "mixed split disc and standalone file",
    files: { "source/SNOS-301.mp4": "standalone", "source/SNOS-301-CD2.mp4": "cd2" },
    status: "failed",
  },
  { name: "chinese subtitle marker", files: { "source/snos-301-C.mp4": "video" } },
  {
    name: "strm with relative target",
    files: {
      "source/SNOS-334.strm": "#KODIPROP:inputstream=inputstream.adaptive\n../library/SNOS-334.mp4\n",
      "library/SNOS-334.mp4": "video",
    },
  },
  {
    name: "subtitle sidecars",
    files: { "source/IPZZ-907.mp4": "video", "source/IPZZ-907.zh.srt": "srt", "source/IPZZ-907.ass": "ass" },
  },
  {
    name: "batch across folders",
    files: {
      "source/a/SNOS-301.mp4": "snos",
      "source/b/IPZZ-907.mp4": "ipzz",
      "source/SNOS-334.mp4": "snos334",
    },
  },
  {
    name: "rerun with current settings",
    files: { "source/SNOS-301.mp4": "video" },
    config: { scrape: { minVideoSizeMb: 1 } },
    rerunConfig: { scrape: { minVideoSizeMb: 0 } },
    rerunLibrary: { placement: "inPlace", outputPath: "" },
  },
  {
    name: "fc2 extra moves with its movie",
    files: { "source/FC2-PPV-4984259.mp4": "video", "source/FC2-PPV-4984259-特典.mp4": "extra" },
  },
  {
    name: "rescrape replaces stale metadata",
    files: { "source/SNOS-301.mp4": "video" },
    rescrape: {
      "output/浅野こころ/SNOS-301/SNOS-301.nfo": "<movie><title>Stale title</title><num>SNOS-301</num></movie>",
    },
  },
];

afterEach(async () => {
  vi.restoreAllMocks();
  await closeTestServers();
});

const describeTree = async (root: string, directory = root): Promise<string[]> => {
  const lines: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      lines.push(...(await describeTree(root, path)));
      continue;
    }
    const name = relative(root, path).replaceAll("\\", "/");
    if (imageExtensions.has(extname(name))) {
      const { width, height } = await sharp(path).metadata();
      lines.push(`${name} ${width}x${height}`);
    } else if (extname(name) === ".nfo") {
      lines.push(name);
    } else {
      const content = await readFile(path);
      lines.push(
        content.includes(0)
          ? `${name} <${content.byteLength} bytes>`
          : `${name} ${JSON.stringify(content.toString("utf8").replaceAll(root, "<root>").replaceAll("\\", "/"))}`,
      );
    }
  }
  return lines.sort();
};

const describeNfo = (xml: string) => ({
  ...Object.fromEntries(
    ["num", "title", "originaltitle", "studio", "premiered", "runtime", "tag"].map((tag) => [
      tag,
      [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "gu"))].map((match) => match[1]),
    ]),
  ),
  actors: [...xml.matchAll(/<actor>\s*<name>([^<]*)<\/name>/gu)].map((match) => match[1]),
});

const runScenario = async ({
  files,
  config,
  rescrape,
  rerunConfig,
  rerunLibrary,
  status = "completed",
}: ReplayScenario) => {
  const root = await createTempRoot("scrape-replay");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  // Vitest's snapshot mode decides recording too: read-only in CI ("none"), record missing movies locally ("new"),
  // and re-record every movie a run touches with -u ("all"). A miss on an existing recording always fails.
  const update = expect.getState().snapshotState.snapshotUpdateState;
  const fixtures = new NetworkFixtureClient({
    recordRoot: fixturesRoot,
    replayRoots: [fixturesRoot],
    mode: (caseId) =>
      !recordedThisRun.has(caseId) &&
      (update === "all" || (update === "new" && !existsSync(join(fixturesRoot, caseId, "manifest.json"))))
        ? "record"
        : "replay",
    discardNetworkFailures: true,
    mockMediaRoot,
    // Replay needs no politeness delay, and a recording run fetches only one movie per site.
    network: { rateLimiter: new RateLimiter(1_000) },
  });
  const aggregate = vi.spyOn(AggregationService.prototype, "aggregate");
  const { fastify, services } = await createTestServer({
    networkClient: fixtures,
    prepareScrapeItem: attachNetworkFixtureCaseId,
  });
  await services.config.update({
    scrape: { sites: [Website.DMM, Website.DMM_TV, Website.AVBASE, Website.FC2] },
    translate: { enableTranslation: false },
    aggregation: { behavior: { maxSceneImages: 3 } },
  });
  if (config) await services.config.update(config);
  const token = await loginAsAdmin(fastify);
  const targetDir = join(root, "output");
  const librarySettings = {
    name: "Library",
    sourcePath: join(root, "source"),
    outputPath: targetDir,
    placement: "move",
  } as const;
  const { libraryId } = await createTestLibrary(fastify, token, librarySettings.sourcePath, librarySettings);
  const scrape = async (procedure: "start" | "rerunDirectory", payload: object) => {
    const response = await fastify.inject({
      method: "POST",
      url: `/trpc/scrape.${procedure}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    const taskId: string = response.json().result.data.runId;
    // Recording a missing movie scrapes the live sites, which takes far longer than replay.
    await waitForScrapeRunStatus(fastify, token, taskId, status, 110_000);
    const snapshot = await services.scrape.snapshot({ taskId });
    return {
      taskId,
      items: snapshot.items.map(
        (item) => `${item.relativePath}: ${item.status}${item.error ? ` (${item.error})` : ""}`,
      ),
    };
  };
  const scrapeDirectory = async (scanDir: string) =>
    await scrape("start", {
      executionMode: "batch",
      source: { kind: "directory", scanDir, recursive: true },
      libraryId,
    });

  const first = await scrapeDirectory(join(root, "source"));
  const results = [first.items];
  if (rescrape) {
    for (const [path, content] of Object.entries(rescrape)) await writeFile(join(root, path), content);
    results.push((await scrapeDirectory(targetDir)).items);
  }
  if (rerunConfig) {
    await services.config.update(rerunConfig);
    if (rerunLibrary) await services.libraries.update(libraryId, { ...librarySettings, ...rerunLibrary });
    results.push((await scrape("rerunDirectory", { taskId: first.taskId })).items);
  }

  for (const caseId of await fixtures.save()) recordedThisRun.add(caseId);
  expect(fixtures.missingInteractions).toEqual([]);
  const tree = await describeTree(root);
  const nfos = Object.fromEntries(
    await Promise.all(
      tree
        .filter((name) => name.endsWith(".nfo") && !name.endsWith("/movie.nfo"))
        .map(async (name) => [name, describeNfo(await readFile(join(root, name), "utf8"))] as const),
    ),
  );
  const library = (await (await services.persistence.getState()).repositories.library.listEntries())
    .map((entry) => ({
      number: entry.number,
      title: entry.title,
      actors: entry.actors,
      files: entry.files.map((file) => file.rootRelativePath).sort(),
    }))
    .sort((left, right) => String(left.number).localeCompare(String(right.number)));
  const aggregations = aggregate.mock.calls.map(([number]) => number).sort();
  return { results, aggregations, tree, nfos, library };
};

it.skipIf(!hasNetworkFixtures).each(scenarios)("scrapes recorded movies end to end: $name", async (scenario) => {
  expect(await runScenario(scenario)).toMatchSnapshot();
});
