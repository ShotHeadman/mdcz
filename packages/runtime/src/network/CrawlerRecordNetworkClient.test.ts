import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CrawlerReplayNetworkClient } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrawlerRecordNetworkClient } from "./CrawlerRecordNetworkClient";
import { loadCrawlerCassette } from "./crawlerCassette";
import { runWithCrawlerSourceContext, runWithScrapeItemContext } from "./crawlerFixtureContext";
import type { CrawlerRecordingPlan } from "./crawlerRecordingPlan";

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

const PLAN: CrawlerRecordingPlan = {
  journeyId: "representative-batch",
  items: [
    { relativePath: "one.mp4", caseId: "movie-one" },
    { relativePath: "nested/two.mp4", caseId: "movie-two" },
  ],
};

const itemOne = { itemId: "one", relativePath: "one.mp4", caseId: "movie-one" };
const itemTwo = { itemId: "two", relativePath: "nested/two.mp4", caseId: "movie-two" };

const createRecorder = async () => {
  const stagingRoot = await tempDir("record-staging");
  const publishRoot = await tempDir("record-publish");
  const recorder = new CrawlerRecordNetworkClient({ stagingRoot, publishRoot, plan: PLAN });
  return { recorder, stagingRoot, publishRoot };
};

const recorded = async <T>(item: typeof itemOne, website: Website, run: () => Promise<T>): Promise<T> =>
  await runWithScrapeItemContext(item, async () => await runWithCrawlerSourceContext(website, run));

const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03, 0x04]);

describe("CrawlerRecordNetworkClient", () => {
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

    const dmmOne = await loadCrawlerCassette(stagingRoot, Website.DMM, "movie-one");
    const javdbOne = await loadCrawlerCassette(stagingRoot, Website.JAVDB, "movie-one");
    const javbusOne = await loadCrawlerCassette(stagingRoot, Website.JAVBUS, "movie-one");
    const dmmTwo = await loadCrawlerCassette(stagingRoot, Website.DMM, "movie-two");

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

    await expect(loadCrawlerCassette(stagingRoot, Website.DMM, "movie-one")).rejects.toThrow();
  });

  it("stores html, json, text, and binary bodies with the original bytes and matching extensions", async () => {
    const html = "<html><body>detail</body></html>";
    const json = '{"title":"SSIS-497"}';
    const text = "plain-body";
    fetchMock
      .mockResolvedValueOnce(new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(json, { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(text, { status: 200, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "8" } }),
      );

    const { recorder, stagingRoot } = await createRecorder();
    await recorded(itemOne, Website.DMM, async () => {
      await recorder.getText("https://www.dmm.co.jp/html");
      await recorder.getJson("https://www.dmm.co.jp/json");
      await recorder.getText("https://www.dmm.co.jp/text");
      await recorder.getContent("https://www.dmm.co.jp/cover.jpg");
    });

    const loaded = await loadCrawlerCassette(stagingRoot, Website.DMM, "movie-one");
    expect(loaded.cassette.interactions.map((interaction) => interaction.response?.bodyPath)).toEqual([
      "responses/001.html",
      "responses/002.json",
      "responses/003.txt",
      "responses/004.jpg",
    ]);
    expect(Buffer.from(loaded.responseBodies.get(1) ?? []).toString("utf8")).toBe(html);
    expect(Buffer.from(loaded.responseBodies.get(2) ?? []).toString("utf8")).toBe(json);
    expect(Buffer.from(loaded.responseBodies.get(3) ?? []).toString("utf8")).toBe(text);
    expect(Buffer.from(loaded.responseBodies.get(4) ?? [])).toEqual(Buffer.from(jpegBytes));
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

    const loaded = await loadCrawlerCassette(stagingRoot, Website.JAVDB, "movie-one");
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
    const published = await loadCrawlerCassette(publishRoot, Website.JAVDB, "movie-one");
    expect(published.cassette.caseId).toBe("movie-one");
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
    await replay.assertConsumed({ caseId: "movie-one", websites: [Website.DMM] });
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
      plan: PLAN,
      network: { getRetryCount: () => 0 },
    });

    await expect(
      recorded(itemOne, Website.DMM, async () => await noRetry.getText("https://www.dmm.co.jp/same")),
    ).rejects.toThrow("socket hang up");
    await expect(
      recorded(itemOne, Website.DMM, async () => await noRetry.getText("https://www.dmm.co.jp/same")),
    ).resolves.toBe("retry-ok");

    const loaded = await loadCrawlerCassette(stagingRoot, Website.DMM, "movie-one");
    expect(loaded.cassette.interactions).toHaveLength(2);
    expect(loaded.cassette.interactions[0]?.transportError).toEqual({ name: "FetchError", message: "socket hang up" });
    expect(loaded.cassette.interactions[1]?.response?.bodyPath).toBe("responses/002.txt");
  });
});
