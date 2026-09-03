import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
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
const item = { itemId: "one", relativePath: "one.mp4", caseId: "one" };

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

const createRecorder = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdcz-record-"));
  temporaryDirectories.push(root);
  const stagingRoot = path.join(root, "staging");
  const publishRoot = path.join(root, "fixtures");
  return { recorder: new NetworkRecordClient({ stagingRoot, publishRoot }), publishRoot };
};

const withCrawler = async <T>(network: () => Promise<T>): Promise<T> =>
  await runWithScrapeItem(item, async () => await runWithCrawlerSource(Website.DMM, network));

describe("network fixtures", () => {
  it("records text and binary responses in one case manifest", async () => {
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    fetchMock
      .mockResolvedValueOnce(new Response("<html>detail</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(image, { headers: { "content-type": "image/jpeg" } }));
    const { recorder, publishRoot } = await createRecorder();
    await withCrawler(async () => {
      await recorder.getText("https://www.dmm.co.jp/detail");
      await recorder.getContent("https://www.dmm.co.jp/poster.jpg");
    });
    await recorder.finalize();

    const manifest = await loadNetworkFixture(publishRoot, "one");
    expect(manifest.interactions.map(({ channel, response }) => [channel, response?.body.kind])).toEqual([
      ["crawler:dmm", "file"],
      ["crawler:dmm", "blob"],
    ]);

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await expect(
      withCrawler(async () => ({
        text: await replay.getText("https://www.dmm.co.jp/detail"),
        image: await replay.getContent("https://www.dmm.co.jp/poster.jpg"),
      })),
    ).resolves.toEqual({ text: "<html>detail</html>", image });
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
    await runWithScrapeItem(item, async () => {
      await runWithNetworkChannel("actor", async () => {
        await runWithSharedNetworkData(async () => await recorder.getText("https://actors.example.com/roster"));
        await recorder.getText("https://actors.example.com/roster");
      });
    });
    await recorder.finalize();

    expect((await loadNetworkFixture(publishRoot, "shared")).interactions).toHaveLength(1);
    expect((await loadNetworkFixture(publishRoot, "one")).interactions).toHaveLength(1);

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await runWithScrapeItem(item, async () => {
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
    await runWithScrapeItem(item, async () => {
      await runWithNetworkChannel("translation", async () => {
        await recorder.postJson("https://llm.example.com/responses", { model: "model-a", input: "prompt-a" });
      });
    });
    await recorder.finalize();

    const replay = new NetworkReplayClient({ fixturesRoot: publishRoot });
    await expect(
      runWithScrapeItem(item, async () => {
        return await runWithNetworkChannel("translation", async () => {
          return await replay.postJson("https://llm.example.com/responses", {
            model: "model-a",
            input: "prompt-b",
          });
        });
      }),
    ).rejects.toThrow(/including shared.*record fixtures again/u);
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

  it("uses mock media when a recorded blob is unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } }),
    );
    const { recorder, publishRoot } = await createRecorder();
    await runWithScrapeItem(item, async () => {
      await runWithNetworkChannel("media", async () => await recorder.getContent("https://cdn.example.com/poster.jpg"));
    });
    await recorder.finalize();
    await rm(path.join(publishRoot, "blobs"), { recursive: true, force: true });

    const replay = new NetworkReplayClient({
      fixturesRoot: publishRoot,
      mockMediaRoot: path.resolve("tests/fixtures/mock-media"),
    });
    const replayed = await runWithScrapeItem(
      item,
      async () =>
        await runWithNetworkChannel("media", async () => await replay.getContent("https://cdn.example.com/poster.jpg")),
    );
    expect(replayed).toEqual(new Uint8Array(await readFile(path.resolve("tests/fixtures/mock-media/sample.jpg"))));
  });
});
