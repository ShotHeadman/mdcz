import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CrawlerReplayNetworkClient, MediaReplayNetworkClient } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrawlerRecordNetworkClient } from "./CrawlerRecordNetworkClient";
import { crawlerCaseIdFromRelativePath, loadCrawlerCassette } from "./crawlerCassette";
import {
  runWithCrawlerSourceContext,
  runWithMediaFixtureContext,
  runWithScrapeItemContext,
} from "./crawlerFixtureContext";
import { loadMockMediaBytes, MissingMediaBlobError } from "./mediaFixture";

const { fetchMock, impitConstructorMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  const impitConstructorMock = vi.fn();
  return { fetchMock, impitConstructorMock };
});

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      __mdczImpitMock?: { fetch: typeof fetchMock; constructorSpy: typeof impitConstructorMock };
    }
  ).__mdczImpitMock = {
    fetch: fetchMock,
    constructorSpy: impitConstructorMock,
  };
  fetchMock.mockReset();
  impitConstructorMock.mockClear();
});

const tempDir = async (label: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), `mdcz-${label}-`));
  directories.push(directory);
  return directory;
};

const itemOne = { itemId: "one", relativePath: "one.mp4", caseId: "one" };
const itemTwo = { itemId: "two", relativePath: "nested/two.mp4", caseId: "two" };

const createRecorder = async () => {
  const stagingRoot = await tempDir("record-staging");
  const publishRoot = await tempDir("record-publish");
  const mediaManifestStagingRoot = await tempDir("media-staging");
  const mediaManifestPublishRoot = await tempDir("media-publish");
  const mediaBlobRoot = await tempDir("media-blobs");
  const recorder = new CrawlerRecordNetworkClient({
    stagingRoot,
    publishRoot,
    mediaManifestStagingRoot,
    mediaManifestPublishRoot,
    mediaBlobRoot,
  });
  return { recorder, stagingRoot, publishRoot, mediaManifestStagingRoot, mediaManifestPublishRoot, mediaBlobRoot };
};

const recorded = async <T>(item: typeof itemOne, website: Website, run: () => Promise<T>): Promise<T> =>
  await runWithScrapeItemContext(item, async () => await runWithCrawlerSourceContext(website, run));

const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03, 0x04]);

describe("CrawlerRecordNetworkClient", () => {
  it.each([
    ["one.mp4", "one"],
    ["nested/two.mp4", "two"],
    ["SSIS-497.mp4", "ssis-497"],
    ["[Censored] SSIS-497 {streaming}.mp4", "censored-ssis-497-streaming"],
  ])("derives caseId %s → %s from the scraped file", (relativePath, caseId) => {
    expect(crawlerCaseIdFromRelativePath(relativePath)).toBe(caseId);
  });

  it("assigns arbitrary items by caseId and isolates concurrent website sources", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(`body:${url}`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    });
    const { recorder, stagingRoot } = await createRecorder();

    await Promise.all([
      recorded(itemOne, Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/one")),
      recorded(itemOne, Website.JAVDB, async () => await recorder.getText("https://javdb.com/one")),
      recorded(itemOne, Website.JAVBUS, async () => await recorder.getText("https://www.javbus.com/one")),
      recorded(itemTwo, Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/two")),
    ]);

    const dmmOne = await loadCrawlerCassette(stagingRoot, Website.DMM, "one");
    const javdbOne = await loadCrawlerCassette(stagingRoot, Website.JAVDB, "one");
    const javbusOne = await loadCrawlerCassette(stagingRoot, Website.JAVBUS, "one");
    const dmmTwo = await loadCrawlerCassette(stagingRoot, Website.DMM, "two");

    expect(dmmOne.cassette.interactions).toHaveLength(1);
    expect(dmmOne.cassette.interactions[0]?.request.url).toBe("https://www.dmm.co.jp/one");
    expect(javdbOne.cassette.interactions[0]?.request.url).toBe("https://javdb.com/one");
    expect(javbusOne.cassette.interactions[0]?.request.url).toBe("https://www.javbus.com/one");
    expect(dmmTwo.cassette.interactions[0]?.request.url).toBe("https://www.dmm.co.jp/two");
    expect(dmmOne.cassette.website).toBe(Website.DMM);
    expect(javdbOne.cassette.website).toBe(Website.JAVDB);
  });

  it("does not record image downloads or other requests outside crawler source context", async () => {
    fetchMock.mockImplementation(
      async () => new Response("poster", { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const { recorder, stagingRoot } = await createRecorder();

    await recorder.getText("https://cdn.example.com/poster.jpg");
    await runWithScrapeItemContext(itemOne, async () => await recorder.getText("https://cdn.example.com/thumb.jpg"));

    await expect(loadCrawlerCassette(stagingRoot, Website.DMM, "one")).rejects.toThrow();
  });

  it("stores html, json, and text bodies with matching extensions", async () => {
    const html = "<html><body>detail</body></html>";
    const json = '{"title":"SSIS-497"}';
    const text = "plain-body";
    fetchMock
      .mockResolvedValueOnce(new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(json, { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(text, { status: 200, headers: { "content-type": "text/plain" } }));

    const { recorder, stagingRoot } = await createRecorder();
    await recorded(itemOne, Website.DMM, async () => {
      await recorder.getText("https://www.dmm.co.jp/html");
      await recorder.getJson("https://www.dmm.co.jp/json");
      await recorder.getText("https://www.dmm.co.jp/text");
    });

    const loaded = await loadCrawlerCassette(stagingRoot, Website.DMM, "one");
    expect(loaded.cassette.interactions.map((interaction) => interaction.response?.bodyPath)).toEqual([
      "responses/001.html",
      "responses/002.json",
      "responses/003.txt",
    ]);
    expect(Buffer.from(loaded.responseBodies.get(1) ?? []).toString("utf8")).toBe(html);
    expect(Buffer.from(loaded.responseBodies.get(2) ?? []).toString("utf8")).toBe(json);
    expect(Buffer.from(loaded.responseBodies.get(3) ?? []).toString("utf8")).toBe(text);
  });

  it.each([
    ["image/jpeg", jpegBytes],
    ["video/mp4", jpegBytes],
    ["application/octet-stream", jpegBytes],
  ])("refuses to write %s into crawler cassette responses", async (contentType, bytes) => {
    fetchMock.mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-type": contentType } }));
    const { recorder, stagingRoot } = await createRecorder();
    await expect(
      recorded(itemOne, Website.DMM, async () => await recorder.getContent("https://www.dmm.co.jp/cover.jpg")),
    ).rejects.toThrow(/Crawler cassette/u);
    await expect(readdir(path.join(stagingRoot, "dmm", "one", "responses"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces the same credential with one fake value across url, headers, and bodies", async () => {
    const secret = "super-secret-session";
    const token = "query-token-abcdef";
    fetchMock.mockResolvedValueOnce(
      new Response(`welcome ${secret}`, {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": "28",
          "set-cookie": `${secret}; Path=/`,
        },
      }),
    );

    const { recorder, stagingRoot, publishRoot } = await createRecorder();
    await recorded(itemOne, Website.JAVDB, async () => {
      await recorder.postText(`https://javdb.com/login?token=${token}`, `session=${secret}`, {
        headers: { cookie: `session=${secret}` },
      });
    });

    const loaded = await loadCrawlerCassette(stagingRoot, Website.JAVDB, "one");
    const cassetteText = JSON.stringify(loaded.cassette);
    const body = Buffer.from(loaded.responseBodies.get(1) ?? []).toString("utf8");
    expect(cassetteText).not.toContain(secret);
    expect(cassetteText).not.toContain(token);
    expect(body).not.toContain(secret);
    expect(body).toContain("mdcz-test-cookie-session");
    expect(loaded.cassette.interactions[0]?.request.url).toContain("mdcz-test-token-token");
    expect(
      loaded.cassette.interactions[0]?.request.headers.some(([, value]) => value.includes("mdcz-test-cookie-session")),
    ).toBe(true);
    expect(Buffer.from(loaded.cassette.interactions[0]?.request.bodyBase64 ?? "", "base64").toString("utf8")).toContain(
      "mdcz-test-cookie-session",
    );
    expect(loaded.cassette.credentialSeed.cookies.session).toBe("mdcz-test-cookie-session");
    expect(loaded.cassette.credentialSeed.tokens.token).toBe("mdcz-test-token-token");
    expect(
      loaded.cassette.interactions[0]?.response?.headers.some(
        ([name, value]) => name === "content-length" && value === "32",
      ),
    ).toBe(true);

    await recorder.finalize();
    const published = await loadCrawlerCassette(publishRoot, Website.JAVDB, "one");
    expect(published.cassette.caseId).toBe("one");
  });

  it("replays a recorded cassette without public network fallback", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const { recorder, stagingRoot } = await createRecorder();
    await recorded(itemOne, Website.DMM, async () => await recorder.getText("https://www.dmm.co.jp/detail"));

    const replay = new CrawlerReplayNetworkClient({ fixturesRoot: stagingRoot });
    await expect(
      recorded(itemOne, Website.DMM, async () => await replay.getText("https://www.dmm.co.jp/detail")),
    ).resolves.toBe("<html>ok</html>");
    await replay.assertConsumed({ caseId: "one", websites: [Website.DMM] });
    await expect(replay.getText("https://www.dmm.co.jp/detail")).rejects.toThrow(
      /public network fallback is disabled/u,
    );
  });

  it("records transport errors and keeps request order for repeated urls", async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { name: "FetchError" }))
      .mockResolvedValueOnce(new Response("retry-ok", { status: 200, headers: { "content-type": "text/plain" } }));
    const { stagingRoot } = await createRecorder();
    const noRetry = new CrawlerRecordNetworkClient({
      stagingRoot,
      publishRoot: await tempDir("record-publish-retry"),
      network: { getRetryCount: () => 0 },
    });

    await expect(
      recorded(itemOne, Website.DMM, async () => await noRetry.getText("https://www.dmm.co.jp/same")),
    ).rejects.toThrow("socket hang up");
    await expect(
      recorded(itemOne, Website.DMM, async () => await noRetry.getText("https://www.dmm.co.jp/same")),
    ).resolves.toBe("retry-ok");

    const loaded = await loadCrawlerCassette(stagingRoot, Website.DMM, "one");
    expect(loaded.cassette.interactions).toHaveLength(2);
    expect(loaded.cassette.interactions[0]?.transportError).toEqual({ name: "FetchError", message: "socket hang up" });
    expect(loaded.cassette.interactions[1]?.response?.bodyPath).toBe("responses/002.txt");
  });

  it("replays a recorded media blob, then falls back to built-in mock media when the blob is missing", async () => {
    fetchMock.mockResolvedValue(
      new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "8" } }),
    );
    const { recorder, mediaManifestStagingRoot, mediaBlobRoot } = await createRecorder();
    const downloaded = await runWithScrapeItemContext(
      itemOne,
      async () =>
        await runWithMediaFixtureContext(async () => await recorder.getContent("https://cdn.example.com/poster.jpg")),
    );
    expect(Buffer.from(downloaded)).toEqual(Buffer.from(jpegBytes));

    const replayExact = new MediaReplayNetworkClient({
      caseId: "one",
      manifestRoot: mediaManifestStagingRoot,
      blobRoot: mediaBlobRoot,
      fallbackToMock: true,
    });
    await expect(
      runWithScrapeItemContext(
        itemOne,
        async () =>
          await runWithMediaFixtureContext(
            async () => await replayExact.getContent("https://cdn.example.com/poster.jpg"),
          ),
      ),
    ).resolves.toEqual(downloaded);
    await replayExact.assertConsumed("one");

    await rm(path.join(mediaBlobRoot, "blobs"), { recursive: true, force: true });
    const replayMock = new MediaReplayNetworkClient({
      caseId: "one",
      manifestRoot: mediaManifestStagingRoot,
      blobRoot: mediaBlobRoot,
      fallbackToMock: true,
    });
    const mocked = await runWithScrapeItemContext(
      itemOne,
      async () =>
        await runWithMediaFixtureContext(async () => await replayMock.getContent("https://cdn.example.com/poster.jpg")),
    );
    expect(Buffer.from(mocked)).toEqual(Buffer.from(await loadMockMediaBytes("image")));
  });

  it("throws when private blobs are missing in strict replay mode", async () => {
    fetchMock.mockResolvedValue(
      new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "8" } }),
    );
    const { recorder, mediaManifestStagingRoot, mediaBlobRoot } = await createRecorder();
    await runWithScrapeItemContext(
      itemOne,
      async () =>
        await runWithMediaFixtureContext(async () => await recorder.getContent("https://cdn.example.com/poster.jpg")),
    );
    await rm(path.join(mediaBlobRoot, "blobs"), { recursive: true, force: true });

    const replay = new MediaReplayNetworkClient({
      caseId: "one",
      manifestRoot: mediaManifestStagingRoot,
      blobRoot: mediaBlobRoot,
      fallbackToMock: false,
    });
    await expect(
      runWithScrapeItemContext(
        itemOne,
        async () =>
          await runWithMediaFixtureContext(async () => await replay.getContent("https://cdn.example.com/poster.jpg")),
      ),
    ).rejects.toThrow(MissingMediaBlobError);
  });
});
