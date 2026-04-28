import { ActorSourceProvider, ActorSourceRegistry, type BaseActorSource } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { ActorProfile } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

const createSource = (
  name: BaseActorSource["name"],
  profile: Partial<ActorProfile> | undefined,
): BaseActorSource & { lookup: ReturnType<typeof vi.fn> } => {
  return {
    name,
    lookup: vi.fn(async () => ({
      source: name,
      success: true,
      profile: profile ? { name: "Actor A", ...profile } : undefined,
      warnings: [],
    })),
  };
};

describe("ActorSourceProvider image lookup", () => {
  it("respects image-source ordering and stops once an earlier source returns photo_url", async () => {
    const cases = [
      {
        registry: () => {
          const official = createSource("official", {
            photo_url: "https://official.example.com/actor-a.jpg",
          });
          const avbase = createSource("avbase", {
            photo_url: "https://avbase.example.com/actor-a.jpg",
          });
          return { sources: { official, avbase }, registry: new ActorSourceRegistry([official, avbase]) };
        },
        config: createConfig({
          personSync: {
            ...defaultConfiguration.personSync,
            personOverviewSources: ["avjoho", "avbase", "official"],
            personImageSources: ["official", "avbase"],
          },
        }),
        expectedPhotoUrl: "https://official.example.com/actor-a.jpg",
        expectedSource: "official",
        called: { official: 1, avbase: 0 },
      },
      {
        registry: () => {
          const local = createSource("local", {
            photo_url: "/tmp/Actor A.jpg",
          });
          const official = createSource("official", {
            photo_url: "https://official.example.com/actor-a.jpg",
          });
          return { sources: { local, official }, registry: new ActorSourceRegistry([local, official]) };
        },
        config: createConfig({
          personSync: {
            ...defaultConfiguration.personSync,
            personImageSources: ["local", "official"],
          },
        }),
        expectedPhotoUrl: "/tmp/Actor A.jpg",
        expectedSource: "local",
        called: { local: 1, official: 0 },
      },
    ];

    for (const { registry, config, expectedPhotoUrl, expectedSource, called } of cases) {
      const { registry: sourceRegistry, sources } = registry();
      const provider = new ActorSourceProvider({
        registry: sourceRegistry,
      });

      const result = await provider.lookup(config, {
        name: "Actor A",
        requiredField: "photo_url",
      });

      expect(result.profile?.photo_url).toBe(expectedPhotoUrl);
      expect(result.profileSources.photo_url).toBe(expectedSource);
      for (const [name, count] of Object.entries(called)) {
        expect(sources[name as keyof typeof sources]?.lookup).toHaveBeenCalledTimes(count);
      }
    }
  });

  it("ignores avjoho photo_url while keeping its overview metadata in full lookups", async () => {
    const avjoho = createSource("avjoho", {
      photo_url: "https://db.avjoho.com/wp-content/uploads/veo00064ps.jpg",
      description: "AVJOHO profile",
    });
    const avbase = createSource("avbase", {
      photo_url: "https://pics.dmm.co.jp/mono/actjpgs/nanase_arisu.jpg",
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([avjoho, avbase]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["avjoho", "avbase", "official"],
          personImageSources: ["local", "avbase"],
        },
      }),
      {
        name: "七瀬アリス",
      },
    );

    expect(result.profile?.description).toBe("AVJOHO profile");
    expect(result.profile?.photo_url).toBe("https://pics.dmm.co.jp/mono/actjpgs/nanase_arisu.jpg");
    expect(result.profileSources.description).toBe("avjoho");
    expect(result.profileSources.photo_url).toBe("avbase");
    expect(avjoho.lookup).toHaveBeenCalledTimes(1);
    expect(avbase.lookup).toHaveBeenCalledTimes(1);
  });

  it("keeps overview metadata on the first qualified source and falls back when earlier sources are too sparse", async () => {
    const cases = [
      {
        registry: () => {
          const official = createSource("official", {
            aliases: ["Official Alias"],
          });
          const avbase = createSource("avbase", {
            description: "AVBASE profile",
            birth_date: "1999-05-08",
          });
          const avjoho = createSource("avjoho", {
            birth_place: "神奈川県",
            blood_type: "A",
            height_cm: 166,
          });
          return {
            sources: { official, avbase, avjoho },
            registry: new ActorSourceRegistry([official, avbase, avjoho]),
          };
        },
        config: createConfig({
          personSync: {
            ...defaultConfiguration.personSync,
            personOverviewSources: ["official", "avbase", "avjoho"],
            personImageSources: ["official", "avbase"],
          },
        }),
        assert: (result: Awaited<ReturnType<ActorSourceProvider["lookup"]>>) => {
          expect(result.profile).toMatchObject({
            name: "Actor A",
            aliases: ["Official Alias"],
            description: "AVBASE profile",
            birth_date: "1999-05-08",
          });
          expect(result.profile.birth_place).toBeUndefined();
          expect(result.profile.height_cm).toBeUndefined();
          expect(result.profileSources.description).toBe("avbase");
          expect(result.profileSources.birth_date).toBe("avbase");
          expect(result.profileSources.birth_place).toBeUndefined();
        },
      },
      {
        registry: () => {
          const official = createSource("official", {
            aliases: ["Official Alias"],
          });
          const avbase = createSource("avbase", {
            birth_date: "1999-05-08",
            birth_place: "神奈川県",
            height_cm: 166,
          });
          return { sources: { official, avbase }, registry: new ActorSourceRegistry([official, avbase]) };
        },
        config: createConfig({
          personSync: {
            ...defaultConfiguration.personSync,
            personOverviewSources: ["official", "avbase"],
          },
        }),
        assert: (result: Awaited<ReturnType<ActorSourceProvider["lookup"]>>) => {
          expect(result.profile.birth_date).toBe("1999-05-08");
          expect(result.profile.birth_place).toBe("神奈川県");
          expect(result.profile.height_cm).toBe(166);
          expect(result.profileSources.birth_date).toBe("avbase");
          expect(result.profile.aliases).toEqual(["Official Alias"]);
        },
      },
    ];

    for (const { registry, config, assert } of cases) {
      const provider = new ActorSourceProvider({
        registry: registry().registry,
      });

      const result = await provider.lookup(config, {
        name: "Actor A",
      });

      assert(result);
    }
  });
});
