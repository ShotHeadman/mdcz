import { AvjohoActorSource } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient, NetworkCookieJar, ResolvedCookie } from "@main/services/network";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getText = vi.fn(async (url: string) => this.handler(url, this.cookieJar));
  readonly createSession = vi.fn((options: { cookieJar?: NetworkCookieJar } = {}) => {
    this.cookieJar = options.cookieJar;
    return {
      getText: this.getText,
    };
  });
  readonly setDomainLimit = vi.fn();

  private cookieJar?: NetworkCookieJar;

  constructor(private readonly handler: (url: string, cookieJar?: NetworkCookieJar) => Promise<string> | string) {}
}

const SEARCH_HTML = `
  <div id="list">
    <article class="article article-list">
      <h1 class="entry-title"><a href="https://db.avjoho.com/%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96/">北川美玖（きたがわみく）</a></h1>
    </article>
  </div>
`;

const DETAIL_HTML = `
  <html>
    <head>
      <meta property="og:title" content="北川美玖（きたがわみく）" />
      <meta property="og:image" content="https://db.avjoho.com/wp-content/uploads/veo00064ps.jpg" />
    </head>
    <body>
      <article class="article">
        <h1 class="entry-title">北川美玖（きたがわみく）</h1>
        <div class="entry-content">
          <table>
            <tr><th>デビュー</th><td>2022年7月5日</td></tr>
            <tr><th>生年月日</th><td>1996年1月31日</td></tr>
            <tr><th>身長</th><td>156cm</td></tr>
            <tr><th>スリーサイズ</th><td>B90cm W56cm H86cm</td></tr>
            <tr><th>カップ</th><td>G</td></tr>
          </table>
          <table>
            <tr><th>出身地</th><td>東京都</td></tr>
            <tr><th>血液型</th><td>AB型</td></tr>
            <tr><th>趣味・特技</th><td>アニメ、舞台鑑賞</td></tr>
            <tr><th>別名</th><td>みく</td></tr>
            <tr><th>専属メーカー</th><td>VENUS</td></tr>
          </table>
        </div>
      </article>
    </body>
  </html>
`;

const CHALLENGE_HTML =
  "<html><body><p>少々お待ちください</p><script>wsidchk</script><p>リクエストが確認されるまでお待ちください</p></body></html>";

const DETAIL_URL = "https://db.avjoho.com/%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96/";

describe("AvjohoActorSource", () => {
  it("matches canonical names and kana aliases from AVJOHO search results", async () => {
    const cases = [
      {
        query: "北川美玖",
        searchUrl: "https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
        assertDetailedProfile: true,
      },
      {
        query: "きたがわみく",
        searchUrl: "https://db.avjoho.com/?s=%E3%81%8D%E3%81%9F%E3%81%8C%E3%82%8F%E3%81%BF%E3%81%8F",
        assertDetailedProfile: false,
      },
    ];

    for (const { query, searchUrl, assertDetailedProfile } of cases) {
      const networkClient = new FakeNetworkClient(async (url: string) => {
        if (url === searchUrl) {
          return SEARCH_HTML;
        }
        if (url === DETAIL_URL) {
          return DETAIL_HTML;
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      const source = new AvjohoActorSource({
        networkClient: networkClient as unknown as NetworkClient,
      });

      const result = await source.lookup(createConfig(), { name: query });

      expect(result.success).toBe(true);
      expect(result.profile?.name).toBe("北川美玖");
      expect(result.profile?.aliases).toContain("きたがわみく");

      if (assertDetailedProfile) {
        expect(result).toMatchObject({
          source: "avjoho",
          success: true,
          profile: {
            name: "北川美玖",
            aliases: ["きたがわみく", "みく"],
            birth_date: "1996-01-31",
            birth_place: "東京都",
            blood_type: "AB",
            height_cm: 156,
            bust_cm: 90,
            waist_cm: 56,
            hip_cm: 86,
            cup_size: "G",
            photo_url: "https://db.avjoho.com/wp-content/uploads/veo00064ps.jpg",
          },
          warnings: [],
        });
        expect(result.profile?.description).toContain("デビュー: 2022年7月5日");
        expect(result.profile?.description).toContain("デビュー: 2022年7月5日\n\n趣味・特技: アニメ、舞台鑑賞");
        expect(result.profile?.description).toContain("趣味・特技: アニメ、舞台鑑賞");
        expect(result.profile?.description).toContain("専属メーカー: VENUS");
        expect(result.profile?.description).not.toContain("生年月日");
        expect(result.profile?.description).not.toContain("身長");
      }
    }
  });

  it("resolves the browser challenge once, retries immediately, and reuses cookies on later lookups", async () => {
    const cookieResolver = vi.fn(
      async (): Promise<ResolvedCookie[]> => [
        {
          name: "wsidchk",
          value: "resolved",
          domain: "db.avjoho.com",
          path: "/",
        },
      ],
    );
    const networkClient = new FakeNetworkClient(async (url: string, cookieJar?: NetworkCookieJar) => {
      const cookies = (await cookieJar?.getCookieString(url)) ?? "";
      const hasChallengeCookie = cookies.includes("wsidchk=resolved");

      if (url.startsWith("https://db.avjoho.com/?s=")) {
        return hasChallengeCookie ? SEARCH_HTML : CHALLENGE_HTML;
      }
      if (url === DETAIL_URL) {
        return DETAIL_HTML;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const source = new AvjohoActorSource({
      networkClient: networkClient as unknown as NetworkClient,
      cookieResolver,
    });

    const first = await source.lookup(createConfig(), { name: "北川美玖" });
    const second = await source.lookup(createConfig(), { name: "きたがわみく" });

    expect(first.success).toBe(true);
    expect(first.profile?.name).toBe("北川美玖");
    expect(first.warnings).toContain(
      "AVJOHO browser challenge detected for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );
    expect(first.warnings).toContain(
      "AVJOHO browser challenge persisted after session retry for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );
    expect(first.warnings).toContain(
      "AVJOHO resolved browser challenge and retried successfully for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );

    expect(second.success).toBe(true);
    expect(second.profile?.name).toBe("北川美玖");
    expect(second.warnings).toEqual([]);

    expect(cookieResolver).toHaveBeenCalledTimes(1);
    expect(networkClient.getText).toHaveBeenCalledTimes(6);
  });

  it("retries with session cookies before escalating to the browser cookie resolver", async () => {
    const networkClient = new FakeNetworkClient(async (url: string, cookieJar?: NetworkCookieJar) => {
      const cookies = (await cookieJar?.getCookieString(url)) ?? "";
      const hasChallengeCookie = cookies.includes("wsidchk=session");

      if (url.startsWith("https://db.avjoho.com/?s=") && !hasChallengeCookie) {
        await cookieJar?.setCookie("wsidchk=session; Path=/", url);
        return CHALLENGE_HTML;
      }
      if (url.startsWith("https://db.avjoho.com/?s=")) {
        return SEARCH_HTML;
      }
      if (url === DETAIL_URL) {
        return DETAIL_HTML;
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const cookieResolver = vi.fn();

    const source = new AvjohoActorSource({
      networkClient: networkClient as unknown as NetworkClient,
      cookieResolver: cookieResolver as unknown as (url: string) => Promise<ResolvedCookie[]>,
    });

    const result = await source.lookup(createConfig(), { name: "北川美玖" });

    expect(result.success).toBe(true);
    expect(result.profile?.name).toBe("北川美玖");
    expect(result.warnings).toContain(
      "AVJOHO resolved browser challenge via session retry for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );
    expect(cookieResolver).not.toHaveBeenCalled();
    expect(networkClient.getText).toHaveBeenCalledTimes(3);
  });

  it("returns warnings when the challenge still persists and no cookie resolver is available", async () => {
    const networkClient = new FakeNetworkClient(async () => CHALLENGE_HTML);
    const source = new AvjohoActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const first = await source.lookup(createConfig(), { name: "北川美玖" });
    const second = await source.lookup(createConfig(), { name: "七瀬アリス" });

    expect(first.success).toBe(true);
    expect(first.warnings).toContain(
      "AVJOHO browser challenge detected for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );
    expect(first.warnings).toContain(
      "AVJOHO browser challenge persisted after session retry for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );
    expect(first.warnings).toContain(
      "AVJOHO cookie resolver is unavailable for https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96",
    );

    expect(second.success).toBe(true);
    expect(second.warnings).toContain(
      "AVJOHO browser challenge detected for https://db.avjoho.com/?s=%E4%B8%83%E7%80%AC%E3%82%A2%E3%83%AA%E3%82%B9",
    );
    expect(second.warnings).toContain(
      "AVJOHO browser challenge persisted after session retry for https://db.avjoho.com/?s=%E4%B8%83%E7%80%AC%E3%82%A2%E3%83%AA%E3%82%B9",
    );
    expect(networkClient.getText).toHaveBeenCalledTimes(4);
  });
});
