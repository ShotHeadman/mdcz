import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { AvbaseActorSource } from "@mdcz/runtime/actorSource";
import type { NetworkClient } from "@mdcz/runtime/network";
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
  it("matches exact names and ruby aliases through the AVBase search and talent APIs", async () => {
    const cases = [
      {
        query: "北川美玖",
        setup: (networkClient: FakeNetworkClient) => {
          networkClient.getJson.mockImplementation(async (url: string) => {
            if (
              url === "https://www.avbase.net/api/public/actors/search?q=%E5%8C%97%E5%B7%9D%E7%BE%8E%E7%8E%96&page=1"
            ) {
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
        },
        assert: (result: Awaited<ReturnType<AvbaseActorSource["lookup"]>>) => {
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
        },
      },
    ];

    for (const { query, setup, assert } of cases) {
      const networkClient = new FakeNetworkClient();
      setup(networkClient);

      const source = new AvbaseActorSource({
        networkClient: networkClient as unknown as NetworkClient,
      });

      const result = await source.lookup(createConfig(), { name: query });
      assert(result);
    }
  });
});
