import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  LocalActorSource,
  OfficialActorSource,
} from "@mdcz/runtime/actorSource";
import type { NetworkClient } from "@mdcz/runtime/network";
import { NfoGenerator } from "@mdcz/runtime/scrape";
import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirectory, type TempDirectoryHarness } from "../../../harness/tempDirectory";

const tempDirs: TempDirectoryHarness[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await createTempDirectory("actor-source-official");
  tempDirs.push(directory);
  return directory.path;
};

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));

  readonly getText = vi.fn(async (_url: string) => "");

  readonly probe = vi.fn(async (url: string) => ({
    ok: false,
    status: 404,
    contentLength: null,
    resolvedUrl: url,
  }));

  readonly setDomainLimit = vi.fn();
}

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABF-300",
  actors: ["中森 ななみ"],
  genres: [],
  studio: "プレステージ",
  publisher: "ABSOLUTELY FANTASIA",
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createOfficialSource = (networkClient: FakeNetworkClient) =>
  new OfficialActorSource({
    networkClient: networkClient as unknown as NetworkClient,
  });

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/actorSource/official/${name}.txt`, import.meta.url), "utf8");

const mockOfficialPages = (
  networkClient: FakeNetworkClient,
  pages: Readonly<Record<string, string | undefined>>,
): void => {
  networkClient.getText.mockImplementation(async (url: string) => {
    const fixtureName = pages[url];
    if (!fixtureName) throw new Error(`Unexpected URL ${url}`);
    return fixture(fixtureName);
  });
};

describe("OfficialActorSource", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((directory) => directory.cleanup()));
  });

  it("checks the agency rosters by stage name when no source hint is available, loading each roster once", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getText.mockImplementation(async (url: string) => {
      if (url === "https://life-promotion.com/") throw new Error("403 Forbidden");
      return url === "https://alive-pro.tokyo/model" ? fixture("alive-list") : "";
    });
    const source = createOfficialSource(networkClient);

    // ALIVE lists 石川 澪 as "MIO ISHIKAWA"; a romanized reading alone is not evidence.
    for (const name of ["中森 ななみ", "Mio Ishikawa"]) {
      expect(await source.lookup(createConfig(), { name })).toEqual({
        source: "official",
        success: false,
        warnings: ["Failed to load official actor data from life: 403 Forbidden"],
      });
    }
    expect(networkClient.getText.mock.calls.map(([url]) => url)).toEqual([
      "https://www.t-powers.co.jp/talent/",
      "https://cmore.jp/official/model.html",
      "https://official.nax-pro.com/model/",
      "https://mines-pro.jp/model/",
      "https://alive-pro.tokyo/model",
      "https://life-promotion.com/",
    ]);
    expect(networkClient.getJson).not.toHaveBeenCalled();
    expect(networkClient.probe).not.toHaveBeenCalled();
  });

  it("routes local prestige hints into the official source and returns the official profile", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Prestige", "ABF-300");
    await mkdir(movieDir, { recursive: true });
    await writeFile(
      join(movieDir, "ABF-300.nfo"),
      new NfoGenerator().buildXml(
        createCrawlerData({
          actor_profiles: undefined,
        }),
      ),
      "utf8",
    );

    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      if (url === "https://www.prestige-av.com/api/actress") {
        return {
          list: [
            {
              uuid: "actress-1",
              name: "中森 ななみ",
              nameKana: "ナカモリナナミ",
              media: {
                path: "a/b/actor.jpg",
              },
            },
          ],
        };
      }

      if (url === "https://www.prestige-av.com/api/actress/actress-1") {
        return {
          uuid: "actress-1",
          name: "中森 ななみ",
          nameKana: "ナカモリナナミ",
          body: "公式プロフィール本文",
          birthday: "2003-08-07T15:00:00.000Z",
          birthPlace: "兵庫県",
          bloodType: "A",
          height: "154",
          breastSize: "83",
          waistSize: "57",
          hipSize: "90",
          hobby: "料理",
          twitterId: "@n_nanami_773",
          media: {
            path: "c/f/cf73d881.jpg",
          },
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([
        new LocalActorSource({ listLibraryDirectories: async () => [root] }),
        createOfficialSource(networkClient),
      ]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official"],
          personImageSources: ["official", "local"],
        },
      }),
      "中森 ななみ",
    );

    expect(result.profile).toMatchObject({
      name: "中森 ななみ",
      aliases: ["ナカモリナナミ"],
      birth_date: "2003-08-07",
      birth_place: "兵庫県",
      blood_type: "A",
      height_cm: 154,
      bust_cm: 83,
      waist_cm: 57,
      hip_cm: 90,
      photo_url: "https://www.prestige-av.com/api/media/c/f/cf73d881.jpg",
    });
    // Facts read into fields stay out of the text; the bio builder writes them once.
    expect(result.profile.description).toBe("公式プロフィール本文\n趣味: 料理\nX: @n_nanami_773");
    expect(result.profileSources.description).toBe("official");
    expect(result.profileSources.birth_date).toBe("official");
    expect(result.profileSources.photo_url).toBe("official");
    expect(networkClient.getJson).toHaveBeenCalledTimes(2);
  });

  it("merges complementary agency and studio official fields in one lookup", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getText.mockImplementation(async (url: string) => {
      if (url === "https://www.t-powers.co.jp/talent/") {
        return `
          <div class="p-talent__list-item">
            <a href="/talent/actor-a/"><div class="p-talent__list-name">Actor A</div><div class="p-talent__list-thumb"><img src="/actor-a-roster.jpg"></div></a>
          </div>
        `;
      }

      if (url === "https://www.t-powers.co.jp/talent/actor-a/") {
        return `
          <h1 class="p-talent-detail__name-pc">Actor A</h1>
          <dl class="p-talent-detail__spec">
            <dt>生年月日</dt><dt>2001年2月3日</dt>
            <dt>出身地</dt><dt>東京都</dt>
            <dt>血液型</dt><dt>O型</dt>
            <dt>身長</dt><dt>160cm</dt>
          </dl>
        `;
      }

      throw new Error(`Unexpected text URL ${url}`);
    });

    networkClient.getJson.mockImplementation(async (url: string) => {
      if (url === "https://www.prestige-av.com/api/actress") {
        return {
          list: [
            {
              uuid: "actress-merge-1",
              name: "Actor A",
              media: { path: "merged/photo.jpg" },
            },
          ],
        };
      }

      if (url === "https://www.prestige-av.com/api/actress/actress-merge-1") {
        return {
          uuid: "actress-merge-1",
          name: "Actor A",
          body: "工作室简介",
          waistSize: "58",
          hipSize: "88",
          media: { path: "merged/photo.jpg" },
        };
      }

      throw new Error(`Unexpected json URL ${url}`);
    });

    const result = await createOfficialSource(networkClient).lookup(createConfig(), {
      name: "Actor A",
      sourceHints: [{ studio: "プレステージ" }],
    });

    expect(result.success).toBe(true);
    expect(result.profile).toMatchObject({
      name: "Actor A",
      birth_date: "2001-02-03",
      birth_place: "東京都",
      blood_type: "O",
      height_cm: 160,
      waist_cm: 58,
      hip_cm: 88,
      photo_url: "https://www.t-powers.co.jp/actor-a-roster.jpg",
    });
    expect(result.profile?.description).toBe("工作室简介");
  });

  it("parses supported official site and agency pages", async () => {
    const cases = [
      {
        pages: {
          "https://faleno.jp/top/actress/": "faleno-list",
          "https://faleno.jp/top/actress/ran_kamiki/": "faleno-detail",
        },
        lookupInput: {
          name: "神木蘭",
          sourceHints: [{ website: Website.FALENO }],
        },
        expectedProfile: {
          name: "神木蘭",
          aliases: ["Ran Kamiki"],
          photo_url: "https://faleno.jp/top/wp-content/uploads/2022/07/kamiki.jpg",
        },
        descriptionFragments: ["誕生日: 10/23", "特技: ダンス"],
      },
      {
        pages: {
          "https://dahlia-av.jp/actress/": "dahlia-list",
          "https://dahlia-av.jp/actress/suzume_mino/": "dahlia-detail",
        },
        lookupInput: {
          name: "美乃すずめ",
          sourceHints: [{ website: Website.DAHLIA }],
        },
        expectedProfile: {
          name: "美乃すずめ",
          aliases: ["Suzume Mino"],
          photo_url: "https://cdn.faleno.net/dahlia/wp-content/uploads/2023/04/mino2.jpg",
        },
        descriptionFragments: ["誕生日: 5/10", "趣味: 料理"],
      },
      {
        pages: {
          "https://www.km-produce.com/girls": "km-produce-list",
          "https://www.km-produce.com/satsukiena": "km-produce-detail",
        },
        lookupInput: {
          name: "沙月恵奈",
          sourceHints: [{ website: Website.KM_PRODUCE }],
        },
        expectedProfile: {
          name: "沙月恵奈",
          aliases: ["Satsuki Ena"],
          birth_date: "1999-06-11",
          photo_url: "https://www.km-produce.com/file/actress_17641394042.jpg",
        },
        descriptionFragments: ["趣味: ゲーム・アニメ"],
      },
      {
        pages: {
          "https://www.t-powers.co.jp/talent/": "t-powers-list",
          "https://www.t-powers.co.jp/talent/ichimiya-kiho/": "t-powers-detail",
        },
        lookupInput: { name: "一宮 希帆" },
        expectedProfile: {
          name: "一宮 希帆",
          aliases: ["Ichimiya Kiho"],
          birth_date: "2004-03-03",
          birth_place: "東京都",
          height_cm: 159,
          bust_cm: 87,
          waist_cm: 57,
          hip_cm: 86,
          cup_size: "E",
          photo_url: "https://www.t-powers.co.jp/wp-content/uploads/profile.jpg",
        },
        descriptionFragments: ["趣味: 読書"],
      },
      {
        pages: {
          "https://cmore.jp/official/model.html": "cmore-list",
          "https://cmore.jp/official/model-julia.html": "cmore-detail",
        },
        lookupInput: { name: "JULIA" },
        expectedProfile: {
          name: "JULIA",
          birth_date: "1987-05-25",
          height_cm: 158,
          bust_cm: 101,
          waist_cm: 55,
          hip_cm: 84,
          cup_size: "J",
          photo_url: "https://cmore.jp/official/img/model/julia/julia.jpg",
        },
        descriptionFragments: ["公式プロフィール本文", "趣味: 自分磨き"],
      },
      {
        pages: {
          "https://official.nax-pro.com/model/": "nax-list",
          "https://official.nax-pro.com/model/56": "nax-detail",
        },
        lookupInput: { name: "伊藤舞雪" },
        expectedProfile: {
          name: "伊藤 舞雪",
          aliases: ["いとうまゆき"],
          birth_date: "1997-11-30",
          height_cm: 160,
          bust_cm: 88,
          waist_cm: 54,
          hip_cm: 89,
          cup_size: "E",
          photo_url: "https://official.nax-pro.com/naxwp/wp-content/uploads/2021/04/ito.jpg",
        },
        descriptionFragments: ["趣味: 映画・音楽鑑賞"],
      },
      {
        pages: {
          "https://mines-pro.jp/model/": "mines-list",
          "https://mines-pro.jp/model/10218": "mines-detail",
        },
        lookupInput: { name: "紗倉まな" },
        expectedProfile: {
          name: "紗倉まな",
          aliases: ["Mana Sakura"],
          birth_date: "1993-03-23",
          birth_place: "神奈川県",
          height_cm: 160,
          bust_cm: 89,
          waist_cm: 58,
          hip_cm: 89,
          cup_size: "F",
          photo_url: "https://mines-pro.jp/talent_images/sakura_mana_10218_1.jpg",
        },
        descriptionFragments: ["趣味: 工場・機械ウォッチング"],
      },
      {
        pages: {
          "https://alive-pro.tokyo/model": "alive-list",
          "https://alive-pro.tokyo/model/mio_ishikawa": "alive-detail",
        },
        lookupInput: { name: "石川澪" },
        expectedProfile: {
          name: "石川 澪",
          aliases: ["いしかわ みお", "MIO ISHIKAWA"],
          height_cm: 158,
          bust_cm: 78,
          waist_cm: 56,
          hip_cm: 88,
          cup_size: "B",
          photo_url: "https://alive-pro.tokyo/official/wp-content/uploads/2025/04/ishikawa03.jpg",
        },
        descriptionFragments: ["誕生日: 3月20日", "出演情報: テレビ番組【月ともぐら】"],
      },
      {
        pages: {
          "https://life-promotion.com/": "life-list",
          "https://life-promotion.com/model/kaede-karen.php": "life-detail",
        },
        lookupInput: { name: "楓カレン" },
        expectedProfile: {
          name: "楓カレン",
          aliases: ["Karen Kaede"],
          birth_date: "1999-08-25",
          height_cm: 162,
          bust_cm: 79,
          waist_cm: 59,
          hip_cm: 81,
          cup_size: "D",
          photo_url: "https://life-promotion.com/images/model/kaede-karen.webp",
        },
        descriptionFragments: ["趣味: 散歩", "特技: 料理"],
      },
    ];

    for (const { pages, lookupInput, expectedProfile, descriptionFragments } of cases) {
      const networkClient = new FakeNetworkClient();
      mockOfficialPages(networkClient, pages);

      const result = await createOfficialSource(networkClient).lookup(createConfig(), lookupInput);

      expect(result.success).toBe(true);
      expect(result.profile).toMatchObject(expectedProfile);
      for (const fragment of descriptionFragments) {
        expect(result.profile?.description).toContain(fragment);
      }
      // Lines whose value was read into a field are left to the bio builder.
      expect(result.profile?.description).not.toMatch(/^(生年月日|出身地|血液型|身長|スリーサイズ|サイズ):/mu);
    }
  });

  it("uses MGStage official photo fallback for 神木麗 when local hints point to MGStage", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "MGStage", "MGS-001");
    await mkdir(movieDir, { recursive: true });
    await writeFile(
      join(movieDir, "MGS-001.nfo"),
      new NfoGenerator().buildXml(
        createCrawlerData({
          number: "MGS-001",
          actors: ["神木麗"],
          actor_profiles: undefined,
          studio: "プレステージ",
          publisher: "PRESTIGE PREMIUM",
          website: Website.MGSTAGE,
        }),
      ),
      "utf8",
    );

    const networkClient = new FakeNetworkClient();
    networkClient.getText.mockResolvedValue("<div id='actress_list'></div>");
    networkClient.probe.mockImplementation(async (url: string) => ({
      ok: url === "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg",
      status: url === "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg" ? 200 : 404,
      contentLength: null,
      resolvedUrl: url,
    }));

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([
        new LocalActorSource({ listLibraryDirectories: async () => [root] }),
        createOfficialSource(networkClient),
      ]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personImageSources: ["official", "local"],
        },
      }),
      "神木麗",
    );

    expect(result.profile.photo_url).toBe(
      "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg",
    );
    expect(result.profileSources.photo_url).toBe("official");
    expect(networkClient.probe).toHaveBeenCalledWith(
      "https://static.mgstage.com/mgs/img/common/actress/%E7%A5%9E%E6%9C%A8%E9%BA%97.jpg",
    );
  });
});
