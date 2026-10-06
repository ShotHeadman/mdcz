import { classifyDmmDetailFailure } from "@mdcz/runtime/crawler/sites/dmm/failureClassifier";
import { JavdbCrawler } from "@mdcz/runtime/crawler/sites/javdb";
import { classifyBlockedPage, NetworkClient, runWithCrawlerSource } from "@mdcz/runtime/network";
import { ReplayResponse } from "@mdcz/runtime/network/ReplayResponse";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

describe("failure classification", () => {
  it("recognizes pages that answer for the network instead of the requested resource", async () => {
    const cases = [
      {
        name: "DMM region page",
        url: "https://www.dmm.co.jp/search/=/searchstr=snos00301/",
        body: "<title>このページはお住まいの地域からご利用になれません。 - FANZA</title>",
        expected: "region_blocked",
      },
      {
        name: "DMM region redirect",
        url: "https://special.fanza.jp/not-available-in-your-region/",
        body: "<html></html>",
        expected: "region_blocked",
      },
      {
        name: "CloudFront block",
        url: "https://www.mgstage.com/",
        body: "<TITLE>ERROR: The request could not be satisfied</TITLE><H2>The request could not be satisfied.</H2> Request blocked.",
        expected: "region_blocked",
      },
      {
        name: "XSERVER block",
        url: "https://faleno.jp/top/?s=atid%20650",
        body: '<title>403 Forbidden</title><meta name="copyright" content="Copyright XSERVER Inc.">',
        expected: "region_blocked",
      },
      {
        name: "Cloudflare challenge",
        url: "https://javdb.com/",
        body: "<title>Just a moment...</title><script>window._cf_chl_opt={}</script>",
        expected: "cloudflare",
      },
      {
        name: "ordinary page",
        url: "https://www.avbase.net/works/SNOS-301",
        body: "<html><h1>SNOS-301</h1></html>",
        expected: null,
      },
    ];
    for (const { name, url, body, expected } of cases) {
      expect(classifyBlockedPage(url, body), name).toBe(expected);
    }

    // JavDB's own block pages count only for JavDB requests, on any mirror.
    for (const [body, reason] of [
      ["<p>Due to copyright restrictions, access is not available</p>", "region_blocked"],
      ["Sorry, we have banned your access temporarily", "ip_banned"],
    ] as const) {
      const client = new NetworkClient({
        siteRequestConfigs: JavdbCrawler.siteRequestConfigs,
        rawDispatch: async ({ url }) =>
          new ReplayResponse(200, "OK", new Headers({ "content-type": "text/html" }), url, Buffer.from(body)),
      });
      await expect(
        runWithCrawlerSource(Website.JAVDB, async () => await client.getText("https://javdb571.com/search?q=SNOS-301")),
      ).rejects.toMatchObject({ reason });
      await expect(
        runWithCrawlerSource(Website.AVBASE, async () => await client.getText("https://www.avbase.net/works/SNOS-301")),
      ).resolves.toBe(body);
    }
  });

  it("explains DMM detail pages that look like a page but carry no metadata", () => {
    const loginWall = `<form><input name="login_id" /><input type="password" name="password" /></form>`;
    const shell = `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`;
    const usable = `<script type="application/ld+json">{"name":"title"}</script><h1 id="title">Normal Title</h1>`;

    expect(classifyDmmDetailFailure(loginWall, "FANZA ログイン", "DMM_TV")?.reason).toBe("login_wall");
    expect(classifyDmmDetailFailure(shell, undefined, "DMM_TV")?.reason).toBe("empty_shell");
    expect(classifyDmmDetailFailure(usable, "正常頁", "DMM")).toBeNull();
  });
});
