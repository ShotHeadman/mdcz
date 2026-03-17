import { AvjohoActorSource } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getText = vi.fn(async (_url: string) => "");
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

describe("AvjohoActorSource", () => {
  it("builds an actor profile from AVJOHO search and detail pages", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getText.mockImplementation(async (url: string) => {
      if (url === "https://db.avjoho.com/?s=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96") {
        return SEARCH_HTML;
      }
      if (url === "https://db.avjoho.com/%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96/") {
        return DETAIL_HTML;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const source = new AvjohoActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await source.lookup(createConfig(), { name: "北川美玖" });

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
  });

  it("can match a kana alias from the AVJOHO result title", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getText.mockImplementation(async (url: string) => {
      if (url === "https://db.avjoho.com/?s=%E3%81%8D%E3%81%9F%E3%81%8C%E3%82%8F%E3%81%BF%E3%81%8F") {
        return SEARCH_HTML;
      }
      if (url === "https://db.avjoho.com/%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96/") {
        return DETAIL_HTML;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const source = new AvjohoActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await source.lookup(createConfig(), { name: "きたがわみく" });

    expect(result.success).toBe(true);
    expect(result.profile?.name).toBe("北川美玖");
    expect(result.profile?.aliases).toContain("きたがわみく");
  });
});
