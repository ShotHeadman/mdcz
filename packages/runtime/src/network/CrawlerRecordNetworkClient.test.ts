import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrawlerRecordNetworkClient } from "./CrawlerRecordNetworkClient";
import { CrawlerReplayNetworkClient } from "./CrawlerReplayNetworkClient";
import { loadCrawlerCassette } from "./crawlerCassette";
import {
  runWithCrawlerSourceContext,
  runWithMediaFixtureContext,
  runWithScrapeItemContext,
} from "./crawlerFixtureContext";
import { MediaReplayNetworkClient } from "./MediaReplayNetworkClient";
import { loadMockMediaBytes } from "./mediaFixture";

const { fetchMock, impitConstructorMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  impitConstructorMock: vi.fn(),
}));

const temporaryDirectories: string[] = [];

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

const item = { itemId: "one", relativePath: "one.mp4", caseId: "one" };

const createRecorder = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdcz-record-"));
  temporaryDirectories.push(root);
  const paths = {
    stagingRoot: path.join(root, "crawler-staging"),
    publishRoot: path.join(root, "crawler"),
    mediaManifestStagingRoot: path.join(root, "media-staging"),
    mediaManifestPublishRoot: path.join(root, "media"),
    mediaBlobRoot: path.join(root, "media"),
  };
  return { recorder: new CrawlerRecordNetworkClient(paths), ...paths };
};

const withCrawler = async <T>(network: () => Promise<T>): Promise<T> =>
  await runWithScrapeItemContext(item, async () => await runWithCrawlerSourceContext(Website.DMM, network));

describe("crawler fixtures", () => {
  it("records and replays crawler text without recording media responses", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html>detail</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    const { recorder, publishRoot } = await createRecorder();

    await withCrawler(async () => {
      await recorder.getText("https://www.dmm.co.jp/detail");
      await recorder.getContent("https://www.dmm.co.jp/poster.jpg");
    });
    await recorder.finalize();

    const cassette = await loadCrawlerCassette(publishRoot, Website.DMM, "one");
    expect(cassette.cassette.interactions).toHaveLength(1);

    const replay = new CrawlerReplayNetworkClient({ fixturesRoot: publishRoot });
    await expect(withCrawler(async () => await replay.getText("https://www.dmm.co.jp/detail"))).resolves.toBe(
      "<html>detail</html>",
    );
    await replay.assertConsumed();
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

    const loaded = await loadCrawlerCassette(publishRoot, Website.DMM, "one");
    const fixture = JSON.stringify(loaded.cassette) + Buffer.from(loaded.responseBodies.get(1) ?? []).toString();
    expect(fixture).not.toContain(cookie);
    expect(fixture).not.toContain(token);
    expect(fixture).toContain("mdcz-test-cookie-session");

    const replay = new CrawlerReplayNetworkClient({ fixturesRoot: publishRoot });
    const replayed = await withCrawler(
      async () =>
        await replay.postText(`https://www.dmm.co.jp/login?token=${token}`, `session=${cookie}`, {
          headers: { cookie: `session=${cookie}` },
        }),
    );
    expect(replayed).toContain("mdcz-test-cookie-session");
    await replay.assertConsumed();
  });

  it("uses mock media when a recorded blob is unavailable", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    fetchMock.mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    const { recorder, mediaManifestPublishRoot, mediaBlobRoot } = await createRecorder();

    await runWithScrapeItemContext(item, async () => {
      await runWithMediaFixtureContext(async () => await recorder.getContent("https://cdn.example.com/poster.jpg"));
    });
    await recorder.finalize();
    await rm(path.join(mediaBlobRoot, "blobs"), { recursive: true, force: true });

    const replay = new MediaReplayNetworkClient({
      caseId: "one",
      manifestRoot: mediaManifestPublishRoot,
      blobRoot: mediaBlobRoot,
    });
    const replayed = await replay.getContent("https://cdn.example.com/poster.jpg");
    expect(replayed).toEqual(await loadMockMediaBytes("image"));
  });
});
