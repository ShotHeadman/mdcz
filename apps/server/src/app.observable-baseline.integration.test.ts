import fs from "node:fs/promises";
import { join } from "node:path";
import { NetworkClient } from "@mdcz/runtime/network";
import { afterEach, expect, it, vi } from "vitest";
import { collectObservableTrace } from "../../../tests/helpers/observableTrace";
import {
  closeTestServers,
  createTempRoot,
  createTestAggregation,
  createTestServer,
  loginAsAdmin,
  startTestImageServer,
  syncMediaRootFromConfig,
  waitForScrapeRunStatus,
} from "./app.testSupport";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("node:fs/promises") & { default: typeof import("node:fs/promises") }
  >();
  return {
    ...original,
    ...Object.fromEntries(
      Object.keys(original.default).map((key) => [
        key,
        (...args: unknown[]) => Reflect.apply(Reflect.get(original.default, key), original.default, args),
      ]),
    ),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeTestServers();
});

const cases = [false, true].flatMap((move) =>
  [false, true].flatMap((crossDevice) => [1, 2].map((parts) => ({ move, crossDevice, parts }))),
);

it.each(cases)("captures observable scrape contracts: move=$move crossDevice=$crossDevice parts=$parts", async ({
  move,
  crossDevice,
  parts,
}) => {
  const root = await createTempRoot("observable-media");
  const names = parts === 1 ? ["ABC-128.mp4"] : ["ABC-128-CD1.mp4", "ABC-128-CD2.mp4"];
  for (const name of names) await fs.writeFile(join(root, name), name);
  const imageServer = await startTestImageServer();
  const aggregation = createTestAggregation(`${imageServer.url}/image.png`);
  const aggregate = vi.spyOn(aggregation, "aggregate");
  const { fastify, services } = await createTestServer({ scrapeAggregation: aggregation });
  await services.config.update({
    behavior: { successFileMove: move, successFileRename: move },
    naming: { folderTemplate: "{number}", fileTemplate: "{number}{part}" },
    download: {
      downloadThumb: true,
      downloadFanart: false,
      downloadSceneImages: false,
      downloadTrailer: false,
      tagBadges: false,
    },
  });
  const token = await loginAsAdmin(fastify);
  const rootId = await syncMediaRootFromConfig(fastify, token, root);
  const state = await services.persistence.getState();
  const trace = collectObservableTrace(state.database.sqlite, { media: root }, crossDevice);
  const download = NetworkClient.prototype.download;
  const networkSpy = vi.spyOn(NetworkClient.prototype, "download").mockImplementation(function (
    this: NetworkClient,
    url,
    outputPath,
    options,
  ) {
    trace.record("http", "network.download", url, outputPath);
    return download.call(this, url, outputPath, options);
  });
  let observed: ReturnType<typeof trace.stop>;
  try {
    trace.record("http", "trpc", "POST", "/trpc/scrape.start");
    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/scrape.start",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        executionMode: "batch",
        refs: names.map((relativePath) => ({ rootId, relativePath })),
        outputRootId: rootId,
        outputRelativeDirectory: "output",
        uncensoredConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(200);
    await waitForScrapeRunStatus(fastify, token, response.json().result.data.runId, "completed");
  } finally {
    observed = trace.stop();
    networkSpy.mockRestore();
  }
  expect(aggregate).toHaveBeenCalledOnce();
  const entries = await state.repositories.library.listEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].files).toHaveLength(parts);
  for (const file of entries[0].files) {
    expect(await fs.readFile(join(root, file.rootRelativePath), "utf8")).toBe(
      names.find((name) => name.includes(file.partSuffix ?? "")),
    );
  }
  for (const name of names) {
    if (move) await expect(fs.stat(join(root, name))).rejects.toMatchObject({ code: "ENOENT" });
    else expect(await fs.readFile(join(root, name), "utf8")).toBe(name);
  }
  expect(observed.counts["filesystem.stat"]).toBeGreaterThan(0);
  expect(observed.counts["sql.run"]).toBeGreaterThan(0);
  expect(observed.counts["http.network.download"]).toBeGreaterThan(0);
  if (move && crossDevice) expect(observed.counts["filesystem-result.rename"]).toBe(parts);
  if (process.env.MDCZ_CAPTURE_BASELINE) {
    const directory = join(process.env.MDCZ_CAPTURE_BASELINE);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      join(directory, `server-${move ? "move" : "write"}-${crossDevice ? "cross" : "same"}-${parts}.json`),
      `${JSON.stringify({ scenario: { host: "server", move, crossDevice, parts }, ...observed }, null, 2)}\n`,
    );
  }
});
