import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  LocalActorSource,
  OfficialActorSource,
} from "@mdcz/runtime/actorSource";
import type { NetworkClient } from "@mdcz/runtime/network";
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
        descriptionFragments: ["身長: 168cm", "趣味: 料理"],
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
          photo_url: "https://www.km-produce.com/file/actress_17641394042.jpg",
        },
        descriptionFragments: ["生年月日: 1999年6月11日", "趣味: ゲーム・アニメ"],
      },
      {
        pages: {
          "https://www.t-powers.co.jp/talent/": "t-powers-list",
          "https://www.t-powers.co.jp/talent/ichimiya-kiho/": "t-powers-detail",
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
        pages: {
          "https://cmore.jp/official/model.html": "cmore-list",
          "https://cmore.jp/official/model-julia.html": "cmore-detail",
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

    for (const { pages, lookupInput, expectedProfile, descriptionFragments } of cases) {
      const networkClient = new FakeNetworkClient();
      mockOfficialPages(networkClient, pages);

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
