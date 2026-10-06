import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkFixtureClient, type NetworkFixtureClientOptions } from "./NetworkFixtureClient";
import {
  reportSiteResult,
  runWithCrawlerSource,
  runWithNetworkChannel,
  runWithScrapeItem,
  runWithSharedNetworkData,
} from "./networkExecution";
import { loadNetworkFixture } from "./networkFixture";
import { SiteError } from "./siteError";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
const temporaryDirectories: string[] = [];
const scrape = () => ({ caseId: "one", execution: {} });
const mockMediaRoot = path.resolve(import.meta.dirname, "../../../../tests/fixtures/mock-media");

beforeEach(() => {
  (globalThis as typeof globalThis & { __mdczImpitMock?: { fetch: typeof fetchMock } }).__mdczImpitMock = {
    fetch: fetchMock,
  };
  fetchMock.mockReset();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5 })),
  );
});

const createRoot = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mdcz-fixtures-"));
  temporaryDirectories.push(directory);
  return directory;
};

// A retry waits a real second; tests that exercise failures issue each attempt themselves.
const createClient = (root: string, mode: "record" | "replay", options: Partial<NetworkFixtureClientOptions> = {}) =>
  new NetworkFixtureClient({
    recordRoot: root,
    replayRoots: [root],
    mode: () => mode,
    mockMediaRoot,
    network: { getRetryCount: () => 0 },
    ...options,
  });

const withSite = async <T>(site: Website, network: () => Promise<T>, item = scrape()): Promise<T> =>
  await runWithScrapeItem(item, async () => await runWithCrawlerSource(site, network));

const withMedia = async <T>(network: () => Promise<T>, item = scrape()): Promise<T> =>
  await runWithScrapeItem(item, async () => await runWithNetworkChannel("media", network));

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

const createJpeg = async (width: number, height: number): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(
    await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .toBuffer(),
  );

describe("network fixtures", () => {
  it("records one scrape across its phases and replays media as stand-ins", async () => {
    const image = await createJpeg(40, 30);
    const interruptedBody = new ReadableStream({
      start: (controller) => controller.error(new Error("socket hang up")),
    });
    fetchMock
      .mockResolvedValueOnce(html("<html>detail</html>"))
      .mockResolvedValueOnce(new Response(interruptedBody, { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(image, { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response("trailer bytes", { headers: { "content-type": "video/mp4" } }));
    const root = await createRoot();
    const recorder = createClient(root, "record");
    const recording = scrape();
    await withSite(Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/detail"), recording);
    await withMedia(async () => {
      await expect(recorder.getContent("https://www.dmm.co.jp/poster.jpg")).rejects.toThrow("socket hang up");
      await recorder.getContent("https://www.dmm.co.jp/poster.jpg");
      await recorder.getContent("https://www.dmm.co.jp/trailer.mp4");
    }, recording);
    expect(await recorder.save()).toEqual(["one"]);

    const manifest = await loadNetworkFixture(root, "one");
    expect(
      manifest.interactions.map(({ channel, response, transportError }) => [channel, response?.body ?? transportError]),
    ).toEqual([
      ["crawler:dmm", expect.objectContaining({ kind: "file" })],
      ["media", { name: "Error", message: "socket hang up" }],
      ["media", expect.objectContaining({ kind: "image", byteLength: image.byteLength, width: 40, height: 30 })],
      ["media", { kind: "video" }],
    ]);

    const replay = createClient(root, "replay");
    const replaying = scrape();
    await expect(
      withSite(Website.DMM, async () => await replay.getText("https://www.dmm.co.jp/detail"), replaying),
    ).resolves.toBe("<html>detail</html>");
    const replayed = await withMedia(async () => {
      await expect(replay.getContent("https://www.dmm.co.jp/poster.jpg")).rejects.toThrow("socket hang up");
      return await replay.getContent("https://www.dmm.co.jp/poster.jpg");
    }, replaying);
    const replayedVideo = await withMedia(
      async () => await replay.getContent("https://www.dmm.co.jp/trailer.mp4"),
      replaying,
    );
    expect(replayedVideo).toEqual(new Uint8Array(await readFile(path.join(mockMediaRoot, "sample.mp4"))));
    expect(replayed).not.toEqual(image);
    expect(replayed.byteLength).toBe(image.byteLength);
    expect(await sharp(replayed).metadata()).toMatchObject({ format: "jpeg", width: 40, height: 30 });
  });

  it("starts the same recording from the beginning for each scrape execution", async () => {
    fetchMock.mockResolvedValue(new Response("detail", { headers: { "content-type": "text/plain" } }));
    const root = await createRoot();
    const recorder = createClient(root, "record");
    await withSite(Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/detail"));
    await recorder.save();
    const replay = createClient(root, "replay");

    for (let run = 0; run < 2; run += 1) {
      await expect(
        withSite(Website.DMM, async () => await replay.getText("https://www.dmm.co.jp/detail")),
      ).resolves.toBe("detail");
    }
  });

  it("records global data once and replays case data before reusable shared data", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("shared roster", { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(new Response("case roster", { headers: { "content-type": "text/plain" } }));
    const root = await createRoot();
    const recorder = createClient(root, "record");
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await runWithSharedNetworkData(async () => await recorder.getText("https://actors.example.com/roster"));
        await recorder.getText("https://actors.example.com/roster");
      });
    });
    await recorder.save();

    expect((await loadNetworkFixture(root, "shared")).interactions).toHaveLength(1);
    expect((await loadNetworkFixture(root, "one")).interactions).toHaveLength(1);

    const replay = createClient(root, "replay");
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("case roster");
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("shared roster");
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("shared roster");
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("matches on method, normalized URL and body, never headers, and explains misses without network fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("photo", { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response('{"output_text":"translated"}', { headers: { "content-type": "application/json" } }),
      );
    const root = await createRoot();
    const recorder = createClient(root, "record");
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await recorder.getText("https://raw.githubusercontent.com/gfriends/a.jpg?t=1&b=2", { headers: { "x-a": "1" } });
      });
      await runWithNetworkChannel("translation", async () => {
        await recorder.postJson("https://llm.example.com/responses", { model: "model-a", input: "prompt-a" });
      });
    });
    await recorder.save();

    const replay = createClient(root, "replay");
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await expect(
          replay.getText("https://raw.githubusercontent.com/gfriends/a.jpg?b=2&t=9", { headers: { "x-b": "2" } }),
        ).resolves.toBe("photo");
      });
      await runWithNetworkChannel("translation", async () => {
        await expect(
          replay.postJson("https://llm.example.com/responses", { model: "model-a", input: "prompt-b" }),
        ).rejects.toThrow(/closest recorded request differs in body/u);
      });
    });
    expect(replay.missingInteractions).toEqual(["one/translation: POST https://llm.example.com/responses"]);
    await expect(
      withSite(Website.DMM, async () => await replay.getText("https://www.dmm.co.jp/detail"), {
        caseId: "unrecorded",
        execution: {},
      }),
    ).rejects.toThrow("No network recording for unrecorded");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redacts credentials before saving", async () => {
    const cookie = "super-secret-session";
    const token = "query-token-abcdef";
    fetchMock.mockResolvedValue(
      new Response(`welcome ${cookie}`, {
        headers: { "content-type": "text/plain", "set-cookie": `session=${cookie}; Path=/` },
      }),
    );
    const root = await createRoot();
    const recorder = createClient(root, "record");
    const login = async (client: NetworkFixtureClient) =>
      await withSite(
        Website.DMM,
        async () =>
          await client.postText(`https://www.dmm.co.jp/login?token=${token}`, `session=${cookie}`, {
            headers: { cookie: `session=${cookie}` },
          }),
      );
    await login(recorder);
    await recorder.save();

    const manifest = await loadNetworkFixture(root, "one");
    const body = manifest.interactions[0]?.response?.body;
    if (body?.kind !== "file") throw new Error("Expected file response");
    const fixture = JSON.stringify(manifest) + (await readFile(path.join(root, "one", body.path), "utf8"));
    expect(fixture).not.toContain(cookie);
    expect(fixture).not.toContain(token);
    expect(fixture).toContain("mdcz-test-cookie-session");
    await expect(login(createClient(root, "replay"))).resolves.toContain("mdcz-test-cookie-session");
  });

  it("files sites that failed because of the recording network as skipped and replays them as that failure", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("dmm")
        ? html("このページはお住まいの地域からご利用になれません")
        : html("<html>avbase detail</html>"),
    );
    const root = await createRoot();
    const recorder = createClient(root, "record", { discardNetworkFailures: true });
    const recording = scrape();
    await runWithScrapeItem(recording, async () => {
      await runWithCrawlerSource(Website.DMM, async () => {
        await expect(recorder.getText("https://www.dmm.co.jp/search")).rejects.toThrow(SiteError);
      });
      await runWithCrawlerSource(Website.AVBASE, async () => await recorder.getText("https://www.avbase.net/works"));
      reportSiteResult({ site: Website.DMM, status: "failed", reason: "region_blocked", elapsedMs: 1 });
      reportSiteResult({ site: Website.AVBASE, status: "success", elapsedMs: 1 });
      reportSiteResult({
        site: Website.JAVDB,
        status: "skipped",
        skipReason: "cooldown",
        reason: "timeout",
        elapsedMs: 0,
      });
    });
    await recorder.save();

    const manifest = await loadNetworkFixture(root, "one");
    expect(manifest.skippedSites).toEqual([
      { site: Website.DMM, reason: "region_blocked" },
      { site: Website.JAVDB, reason: "timeout" },
    ]);
    expect(manifest.interactions.map(({ channel }) => channel)).toEqual(["crawler:avbase"]);

    const replay = createClient(root, "replay");
    const replaying = scrape();
    await expect(
      withSite(Website.DMM, async () => await replay.getText("https://www.dmm.co.jp/search"), replaying),
    ).rejects.toMatchObject({ reason: "region_blocked" });
    await expect(
      withSite(Website.AVBASE, async () => await replay.getText("https://www.avbase.net/works"), replaying),
    ).resolves.toBe("<html>avbase detail</html>");
    expect(replay.missingInteractions).toEqual([]);
  });

  it("autosaves each movie when a scrape phase ends, replacing its previous recording", async () => {
    fetchMock.mockResolvedValueOnce(html("first")).mockResolvedValueOnce(html("second"));
    const root = await createRoot();
    const recorder = createClient(root, "record", { autosave: true });

    await withSite(Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/detail"));
    const first = await loadNetworkFixture(root, "one");
    await withSite(Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/detail?page=2"));
    const second = await loadNetworkFixture(root, "one");

    expect(first.interactions.map(({ request }) => request.url)).toEqual(["https://www.dmm.co.jp/detail"]);
    expect(second.interactions.map(({ request }) => request.url)).toEqual(["https://www.dmm.co.jp/detail?page=2"]);
  });
});
