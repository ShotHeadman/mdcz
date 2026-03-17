import { AvbaseActorSource } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));
}

describe("AvbaseActorSource", () => {
  it("builds an actor profile from AVBase search and talent APIs", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      if (url === "https://www.avbase.net/api/public/actors/search?q=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96&page=1") {
        return [
          {
            actors: [
              {
                id: 49045,
                name: "北川美玖",
                ruby: "きたがわみく",
                image_url: "",
                note: "みく",
              },
            ],
          },
        ];
      }

      if (url === "https://www.avbase.net/api/public/talents?actor_id=49045") {
        return {
          profile: "プロフィール本文",
          meta: {
            basic_info: {
              birthday: "1996-01-31",
              prefectures: "東京都",
              height: "156",
              bust: "90",
              waist: "56",
              hip: "86",
              cup: "G",
              blood_type: "AB",
              hobby: "アニメ",
            },
            sns: [{ sns: "twitter", id: "kitagawa_miku" }],
          },
          primary: {
            id: 49045,
            name: "北川美玖",
            ruby: "きたがわみく",
            url: "https://example.com/kitagawa-miku",
            image_url: "https://example.com/actor.jpg",
            note: null,
          },
          actors: [
            {
              id: 49045,
              name: "北川美玖",
              ruby: "きたがわみく",
              image_url: "https://example.com/actor.jpg",
              note: "みく",
            },
          ],
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });
    const source = new AvbaseActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await source.lookup(createConfig(), { name: "北川美玖" });

    expect(result).toMatchObject({
      source: "avbase",
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
        photo_url: "https://example.com/actor.jpg",
      },
      warnings: [],
    });
    expect(result.profile?.description).toContain("プロフィール本文");
    expect(result.profile?.description).toContain("趣味: アニメ");
    expect(result.profile?.description).toContain("SNS:\ntwitter: kitagawa_miku");
  });

  it("can match a ruby alias through the AVBase search API", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      if (
        url ===
        "https://www.avbase.net/api/public/actors/search?q=%E3%81%8D%E3%81%9F%E3%81%8C%E3%82%8F%E3%81%BF%E3%81%8F&page=1"
      ) {
        return [
          {
            actors: [
              {
                id: 49045,
                name: "北川美玖",
                ruby: "きたがわみく",
                image_url: "",
                note: null,
              },
            ],
          },
        ];
      }

      if (url === "https://www.avbase.net/api/public/talents?actor_id=49045") {
        return {
          profile: null,
          meta: null,
          primary: {
            id: 49045,
            name: "北川美玖",
            ruby: "きたがわみく",
            url: "https://www.avbase.net/actors/49045",
            image_url: "https://cdn.example.com/actor.jpg",
            note: null,
          },
          actors: [],
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const source = new AvbaseActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await source.lookup(createConfig(), { name: "きたがわみく" });

    expect(result.success).toBe(true);
    expect(result.profile?.name).toBe("北川美玖");
    expect(result.profile?.aliases).toContain("きたがわみく");
    expect(result.profile?.photo_url).toBe("https://cdn.example.com/actor.jpg");
  });

  it("does not fall back to the first unrelated candidate when multiple results exist", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      if (url === "https://www.avbase.net/api/public/actors/search?q=%E7%A5%9E%E6%9C%A8%E9%BA%97&page=1") {
        return [
          {
            actors: [
              { id: 1, name: "三上悠亜", ruby: "みかみゆあ", note: null },
              { id: 2, name: "河北彩花", ruby: "かわきたさいか", note: null },
            ],
          },
        ];
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const source = new AvbaseActorSource({
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await source.lookup(createConfig(), { name: "神木麗" });

    expect(result).toMatchObject({
      source: "avbase",
      success: true,
      warnings: [],
    });
    expect(result.profile).toBeUndefined();
    expect(networkClient.getJson).toHaveBeenCalledTimes(1);
  });
});
