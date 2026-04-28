import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  LocalActorSource,
  OfficialActorSource,
} from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-actor-source-official-"));
  tempDirs.push(dirPath);
  return dirPath;
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

describe("OfficialActorSource", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("does not call remote official sources when no source hint is available", async () => {
    const networkClient = new FakeNetworkClient();
    const source = createOfficialSource(networkClient);

    const result = await source.lookup(createConfig(), {
      name: "中森 ななみ",
    });

    expect(result).toEqual({
      source: "official",
      success: true,
      warnings: [],
    });
    expect(networkClient.getJson).not.toHaveBeenCalled();
    expect(networkClient.getText).not.toHaveBeenCalled();
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
      registry: new ActorSourceRegistry([new LocalActorSource(), createOfficialSource(networkClient)]),
    });

    const result = await provider.lookup(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
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
    expect(result.profile.description).toContain("公式プロフィール本文");
    expect(result.profile.description).toContain("生年月日: 2003-08-07");
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
      sourceHints: [{ agency: "T-Powers" }, { studio: "プレステージ" }],
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
    expect(result.profile?.description).toContain("生年月日: 2001年2月3日");
    expect(result.profile?.description).not.toContain("工作室简介");
  });

  it("parses supported official site and agency pages", async () => {
    const cases = [
      {
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getText.mockImplementation(async (url: string) => {
            if (url === "https://faleno.jp/top/actress/") {
              return `
                <div class="box_actress01">
                  <ul>
                    <li>
                      <div class="img_actress01">
                        <a href="https://faleno.jp/top/actress/ran_kamiki/">
                          <img src="https://faleno.jp/top/wp-content/uploads/2022/07/kamiki.jpg">
                        </a>
                      </div>
                      <div class="text_name">神木蘭<span>Ran Kamiki</span></div>
                    </li>
                  </ul>
                </div>
              `;
            }

            if (url === "https://faleno.jp/top/actress/ran_kamiki/") {
              return `
                <section class="back01">
                  <div class="bar02_category"><h1>神木蘭<span>Ran Kamiki</span></h1></div>
                  <div class="box_actress02">
                    <div class="box_actress02_left"><img src="https://faleno.jp/top/wp-content/uploads/2022/07/kamiki.jpg"></div>
                    <div class="box_actress02_list">
                      <ul>
                        <li><span>誕生日</span><p>10/23</p></li>
                        <li><span>身長</span><p>163cm</p></li>
                        <li><span>スリーサイズ</span><p>B84 W56 H84</p></li>
                      </ul>
                      <ul>
                        <li><span>出身地</span><p>東京都</p></li>
                        <li><span>趣味</span><p>映画鑑賞</p></li>
                        <li><span>特技</span><p>ダンス</p></li>
                      </ul>
                    </div>
                  </div>
                </section>
              `;
            }

            throw new Error(`Unexpected URL ${url}`);
          });
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
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getText.mockImplementation(async (url: string) => {
            if (url === "https://dahlia-av.jp/actress/") {
              return `
                <div class="box_actress01">
                  <ul>
                    <li>
                      <div class="img_actress01">
                        <a href="https://dahlia-av.jp/actress/suzume_mino/">
                          <img src="https://cdn.faleno.net/dahlia/wp-content/uploads/2023/04/mino2.jpg">
                        </a>
                      </div>
                      <div class="text_name">美乃すずめ<span>Suzume Mino</span></div>
                    </li>
                  </ul>
                </div>
              `;
            }

            if (url === "https://dahlia-av.jp/actress/suzume_mino/") {
              return `
                <section class="back01">
                  <div class="bar02_category"><h1>美乃すずめ<span>Suzume Mino</span></h1></div>
                  <div class="box_actress02">
                    <div class="box_actress02_left"><img src="https://cdn.faleno.net/dahlia/wp-content/uploads/2023/04/mino2.jpg"></div>
                    <div class="box_actress02_list">
                      <ul>
                        <li><span>誕生日</span><p>5/10</p></li>
                        <li><span>身長</span><p>168cm</p></li>
                        <li><span>スリーサイズ</span><p>B93 W60 H89</p></li>
                      </ul>
                      <ul>
                        <li><span>出身地</span><p>兵庫県</p></li>
                        <li><span>趣味</span><p>料理</p></li>
                        <li><span>特技</span><p>二重跳び</p></li>
                      </ul>
                    </div>
                  </div>
                </section>
              `;
            }

            throw new Error(`Unexpected URL ${url}`);
          });
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
        descriptionFragments: ["身長: 168cm", "趣味: 料理"],
      },
      {
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getText.mockImplementation(async (url: string) => {
            if (url === "https://www.km-produce.com/girls") {
              return `
                <section class="senzoku col">
                  <div class="col4">
                    <div class="act">
                      <a href="satsukiena">
                        <p class="photo"><img src="https://www.km-produce.com/file/actress_17641394042.jpg" alt="沙月恵奈"></p>
                        <div class="arw_r">
                          <h4>沙月恵奈<aside>Satsuki Ena</aside></h4>
                          <p class="size">152cm/B85-E/W58/H86</p>
                          <p class="works"><a href="https://www.km-produce.com/works/category/沙月恵奈">works</a></p>
                        </div>
                      </a>
                    </div>
                  </div>
                </section>
              `;
            }

            if (url === "https://www.km-produce.com/satsukiena") {
              return `
                <section class="details col" id="profileWrap">
                  <div class="profile">
                    <div class="photo">
                      <img src="https://www.km-produce.com/file/actress_17641394042.jpg" alt="沙月恵奈" class="main">
                    </div>
                    <div class="data">
                      <div class="name">
                        <h1>沙月恵奈</h1>
                        <p>Satsuki Ena</p>
                      </div>
                      <dl>
                        <dt>生年月日</dt><dd>1999年6月11日</dd>
                        <dt>血液型</dt><dd>A型</dd>
                        <dt>身長</dt><dd>152cm</dd>
                        <dt>スリーサイズ</dt><dd>B85(Eカップ) W58 H86</dd>
                        <dt>趣味</dt><dd>ゲーム・アニメ</dd>
                      </dl>
                    </div>
                  </div>
                </section>
              `;
            }

            throw new Error(`Unexpected URL ${url}`);
          });
        },
        lookupInput: {
          name: "沙月恵奈",
          sourceHints: [{ website: Website.KM_PRODUCE }],
        },
        expectedProfile: {
          name: "沙月恵奈",
          aliases: ["Satsuki Ena"],
          photo_url: "https://www.km-produce.com/file/actress_17641394042.jpg",
        },
        descriptionFragments: ["生年月日: 1999年6月11日", "趣味: ゲーム・アニメ"],
      },
      {
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getText.mockImplementation(async (url: string) => {
            if (url === "https://www.t-powers.co.jp/talent/") {
              return `
                <div class="p-talent__list-item">
                  <a href="https://www.t-powers.co.jp/talent/ichimiya-kiho/">
                    <div class="p-talent__list-thumb">
                      <img src="https://www.t-powers.co.jp/wp-content/uploads/thumb.jpg">
                    </div>
                    <h3 class="p-talent__list-name">一宮 希帆</h3>
                  </a>
                </div>
              `;
            }

            if (url === "https://www.t-powers.co.jp/talent/ichimiya-kiho/") {
              return `
                <section class="l-content__body">
                  <h1 class="p-talent-detail__name-pc">一宮 希帆</h1>
                  <div class="p-talent-detail__vis-name-item">Ichimiya Kiho</div>
                  <div class="p-talent-detail__vis-slider-img" style="background-image: url(https://www.t-powers.co.jp/wp-content/uploads/profile.jpg);"></div>
                  <dl class="p-talent-detail__spec">
                    <dt class="p-talent-detail__term">生年月日</dt>
                    <dt class="p-talent-detail__desc">2004年3月3日</dt>
                    <dt class="p-talent-detail__term">出身地</dt>
                    <dt class="p-talent-detail__desc">東京都</dt>
                    <dt class="p-talent-detail__term">身長</dt>
                    <dt class="p-talent-detail__desc">159cm</dt>
                  </dl>
                </section>
              `;
            }

            throw new Error(`Unexpected URL ${url}`);
          });
        },
        lookupInput: {
          name: "一宮 希帆",
          sourceHints: [{ agency: "T-Powers" }],
        },
        expectedProfile: {
          name: "一宮 希帆",
          aliases: ["Ichimiya Kiho"],
          photo_url: "https://www.t-powers.co.jp/wp-content/uploads/profile.jpg",
        },
        descriptionFragments: ["生年月日: 2004年3月3日", "出身地: 東京都"],
      },
      {
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getText.mockImplementation(async (url: string) => {
            if (url === "https://cmore.jp/official/model.html") {
              return `
                <li class="list-box_item">
                  <a href="model-julia.html" class="box">
                    <p class="box_eyecatch"><img src="img/model/julia/julia.jpg" alt="JULIA"></p>
                  </a>
                  <dl class="box_text">
                    <dt class="heading-lv4">JULIA<br><div class="listicon"></div></dt>
                  </dl>
                </li>
              `;
            }

            if (url === "https://cmore.jp/official/model-julia.html") {
              return `
                <html>
                  <head>
                    <title>JULIA｜AVプロダクション C-more シーモア エンターテイメント</title>
                  </head>
                  <body>
                    <div class="block-item_media-large"><img src="img/model/julia/julia.jpg"></div>
                    <div class="block-item_content">
                      <span class="org">【生年月日】</span><br>1987年05月25日<br>
                      <span class="org">【サイズ】</span><br>B101 W55 H85<br>
                      公式プロフィール本文
                    </div>
                  </body>
                </html>
              `;
            }

            throw new Error(`Unexpected URL ${url}`);
          });
        },
        lookupInput: {
          name: "JULIA",
          sourceHints: [{ agency: "C-more" }],
        },
        expectedProfile: {
          name: "JULIA",
          birth_date: "1987-05-25",
          bust_cm: 101,
          waist_cm: 55,
          hip_cm: 85,
          photo_url: "https://cmore.jp/official/img/model/julia/julia.jpg",
        },
        descriptionFragments: ["生年月日: 1987年05月25日", "公式プロフィール本文"],
      },
    ];

    for (const { setup, lookupInput, expectedProfile, descriptionFragments } of cases) {
      const networkClient = new FakeNetworkClient();
      setup(networkClient);

      const result = await createOfficialSource(networkClient).lookup(createConfig(), lookupInput);

      expect(result.success).toBe(true);
      expect(result.profile).toMatchObject(expectedProfile);
      for (const fragment of descriptionFragments) {
        expect(result.profile?.description).toContain(fragment);
      }
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
      registry: new ActorSourceRegistry([new LocalActorSource(), createOfficialSource(networkClient)]),
    });

    const result = await provider.lookup(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
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
