import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkRecordClient, NetworkReplayClient } from "./NetworkFixtureClient";
import {
  runWithCrawlerSource,
  runWithNetworkChannel,
  runWithScrapeItem,
  runWithSharedNetworkData,
} from "./networkExecution";
import { loadNetworkFixture } from "./networkFixture";

const { fetchMock, impitConstructorMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  impitConstructorMock: vi.fn(),
}));
const temporaryDirectories: string[] = [];
const scrape = () => ({ caseId: "one", execution: {} });

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      __mdczImpitMock?: { fetch: typeof fetchMock; constructorSpy: typeof impitConstructorMock };
    }
  ).__mdczImpitMock = { fetch: fetchMock, constructorSpy: impitConstructorMock };
  fetchMock.mockReset();
  impitConstructorMock.mockClear();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createRecorder = async (root?: string) => {
  const directory = root ?? (await mkdtemp(path.join(tmpdir(), "mdcz-record-")));
  temporaryDirectories.push(directory);
  const stagingRoot = path.join(directory, "staging");
  const publishRoot = path.join(directory, "fixtures");
  // A retry waits a real second; tests that exercise failures issue each attempt themselves.
  const network = { getRetryCount: () => 0 };
  return { recorder: new NetworkRecordClient({ stagingRoot, publishRoot, network }), publishRoot, root: directory };
};

const withCrawler = async <T>(network: () => Promise<T>, item = scrape()): Promise<T> =>
  await runWithScrapeItem(item, async () => await runWithCrawlerSource(Website.DMM, network));

const withMedia = async <T>(network: () => Promise<T>, item = scrape()): Promise<T> =>
  await runWithScrapeItem(item, async () => await runWithNetworkChannel("media", network));

const createJpeg = async (width: number, height: number): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(
    await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .toBuffer(),
  );

describe("network fixtures", () => {
  it("records every request of one scrape across its prepare and publish phases", async () => {
    const image = await createJpeg(3, 2);
    const interruptedBody = new ReadableStream({
      start: (controller) => controller.error(new Error("socket hang up")),
    });
    fetchMock
      .mockResolvedValueOnce(new Response("<html>detail</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(interruptedBody, { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(image, { headers: { "content-type": "image/jpeg" } }));
    const { recorder, publishRoot } = await createRecorder();
    const recording = scrape();
    await withCrawler(async () => await recorder.getText("https://www.dmm.co.jp/detail"), recording);
    await withMedia(async () => {
      await expect(recorder.getContent("https://www.dmm.co.jp/poster.jpg")).rejects.toThrow("socket hang up");
      await recorder.getContent("https://www.dmm.co.jp/poster.jpg");
    }, recording);
    await recorder.finalize();

    const manifest = await loadNetworkFixture(publishRoot, "one");
    expect(
      manifest.interactions.map(({ channel, response, transportError }) => [channel, response?.body ?? transportError]),
    ).toEqual([
      ["crawler:dmm", expect.objectContaining({ kind: "file" })],
      ["media", { name: "Error", message: "socket hang up" }],
      ["media", expect.objectContaining({ kind: "blob", byteLength: image.byteLength, width: 3, height: 2 })],
    ]);

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot, network: { getRetryCount: () => 0 } });
    const replaying = scrape();
    await expect(
      withCrawler(async () => await replay.getText("https://www.dmm.co.jp/detail"), replaying),
    ).resolves.toBe("<html>detail</html>");
    await withMedia(async () => {
      await expect(replay.getContent("https://www.dmm.co.jp/poster.jpg")).rejects.toThrow("socket hang up");
      await expect(replay.getContent("https://www.dmm.co.jp/poster.jpg")).resolves.toEqual(image);
    }, replaying);
  });

  it("starts the same fixture from the beginning for each scrape execution", async () => {
    fetchMock.mockResolvedValue(new Response("detail", { headers: { "content-type": "text/plain" } }));
    const { recorder, publishRoot } = await createRecorder();
    await withCrawler(async () => await recorder.getText("https://www.dmm.co.jp/detail"));
    await recorder.finalize();
    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });

    await expect(withCrawler(async () => await replay.getText("https://www.dmm.co.jp/detail"))).resolves.toBe("detail");
    await expect(withCrawler(async () => await replay.getText("https://www.dmm.co.jp/detail"))).resolves.toBe("detail");
  });

  it("records global data once and replays case data before reusable shared data", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("shared roster", { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(new Response("case roster", { headers: { "content-type": "text/plain" } }));
    const { recorder, publishRoot } = await createRecorder();
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await runWithSharedNetworkData(async () => await recorder.getText("https://actors.example.com/roster"));
        await recorder.getText("https://actors.example.com/roster");
      });
    });
    await recorder.finalize();

    expect((await loadNetworkFixture(publishRoot, "shared")).interactions).toHaveLength(1);
    expect((await loadNetworkFixture(publishRoot, "one")).interactions).toHaveLength(1);

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("actor", async () => {
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("case roster");
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("shared roster");
        await expect(replay.getText("https://actors.example.com/roster")).resolves.toBe("shared roster");
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects changed translation request bodies without public network fallback", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"output_text":"translated"}', { headers: { "content-type": "application/json" } }),
    );
    const { recorder, publishRoot } = await createRecorder();
    await runWithScrapeItem(scrape(), async () => {
      await runWithNetworkChannel("translation", async () => {
        await recorder.postJson("https://llm.example.com/responses", { model: "model-a", input: "prompt-a" });
      });
    });
    await recorder.finalize();

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await expect(
      runWithScrapeItem(scrape(), async () => {
        return await runWithNetworkChannel("translation", async () => {
          return await replay.postJson("https://llm.example.com/responses", {
            model: "model-a",
            input: "prompt-b",
          });
        });
      }),
    ).rejects.toThrow(/including shared.*record fixtures again/u);
    expect(replay.missingInteractions).toEqual(["one/translation: POST https://llm.example.com/responses"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts credentials before publishing", async () => {
    const cookie = "super-secret-session";
    const token = "query-token-abcdef";
    fetchMock.mockResolvedValue(
      new Response(`welcome ${cookie}`, {
        headers: { "content-type": "text/plain", "set-cookie": `session=${cookie}; Path=/` },
      }),
    );
    const { recorder, publishRoot } = await createRecorder();
    await withCrawler(async () => {
      await recorder.postText(`https://www.dmm.co.jp/login?token=${token}`, `session=${cookie}`, {
        headers: { cookie: `session=${cookie}` },
      });
    });
    await recorder.finalize();

    const manifest = await loadNetworkFixture(publishRoot, "one");
    const body = manifest.interactions[0]?.response?.body;
    if (body?.kind !== "file") throw new Error("Expected file response");
    const fixture = JSON.stringify(manifest) + (await readFile(path.join(publishRoot, "one", body.path), "utf8"));
    expect(fixture).not.toContain(cookie);
    expect(fixture).not.toContain(token);
    expect(fixture).toContain("mdcz-test-cookie-session");

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await expect(
      withCrawler(
        async () =>
          await replay.postText(`https://www.dmm.co.jp/login?token=${token}`, `session=${cookie}`, {
            headers: { cookie: `session=${cookie}` },
          }),
      ),
    ).resolves.toContain("mdcz-test-cookie-session");
  });

  it("serves published media to downloads when recording again while fetching pages live", async () => {
    const image = await createJpeg(4, 3);
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith(".jpg")
        ? new Response(image, { headers: { "content-type": "image/jpeg" } })
        : new Response("detail", { headers: { "content-type": "text/plain" } }),
    );
    const record = async (root?: string) => {
      const recording = await createRecorder(root);
      await runWithScrapeItem(scrape(), async () => {
        await runWithCrawlerSource(
          Website.DMM,
          async () => await recording.recorder.getText("https://www.dmm.co.jp/detail"),
        );
        await runWithNetworkChannel(
          "media",
          async () =>
            await recording.recorder.download(
              "https://cdn.example.com/poster.jpg",
              path.join(recording.root, "poster.jpg"),
            ),
        );
      });
      await recording.recorder.finalize();
      return recording;
    };

    const first = await record();
    fetchMock.mockClear();
    await rm(path.join(first.root, "poster.jpg"));
    await record(first.root);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://www.dmm.co.jp/detail"]);
    expect(new Uint8Array(await readFile(path.join(first.root, "poster.jpg")))).toEqual(image);
    expect((await loadNetworkFixture(first.publishRoot, "one")).interactions.map(({ channel }) => channel)).toEqual([
      "crawler:dmm",
      "media",
    ]);
  });

  it("synthesizes recorded images with their dimensions and size instead of local blobs", async () => {
    const image = await createJpeg(40, 30);
    fetchMock.mockResolvedValue(new Response(image, { headers: { "content-type": "image/jpeg" } }));
    const { recorder, publishRoot } = await createRecorder();
    await withMedia(async () => await recorder.getContent("https://cdn.example.com/poster.jpg"));
    await recorder.finalize();

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot, syntheticMedia: true });
    const replayed = await withMedia(async () => await replay.getContent("https://cdn.example.com/poster.jpg"));

    expect(replayed).not.toEqual(image);
    expect(replayed.byteLength).toBe(image.byteLength);
    expect(await sharp(replayed).metadata()).toMatchObject({ format: "jpeg", width: 40, height: 30 });
  });
});
