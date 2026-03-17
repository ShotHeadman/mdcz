import { ActorSourceProvider, ActorSourceRegistry, type BaseActorSource } from "@main/services/actorSource";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import type { ActorProfile } from "@shared/types";
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
  it("prioritizes configured image sources for photo-only lookups", async () => {
    const official = createSource("official", {
      photo_url: "https://official.example.com/actor-a.jpg",
    });
    const avbase = createSource("avbase", {
      photo_url: "https://avbase.example.com/actor-a.jpg",
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([official, avbase]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["avjoho", "avbase", "official"],
          personImageSources: ["official", "avbase"],
        },
      }),
      {
        name: "Actor A",
        requiredField: "photo_url",
      },
    );

    expect(result.profile?.photo_url).toBe("https://official.example.com/actor-a.jpg");
    expect(result.profileSources.photo_url).toBe("official");
    expect(official.lookup).toHaveBeenCalledTimes(1);
    expect(avbase.lookup).not.toHaveBeenCalled();
  });

  it("stops photo-only lookup once an earlier image source already returns photo_url", async () => {
    const local = createSource("local", {
      photo_url: "/tmp/Actor A.jpg",
    });
    const official = createSource("official", {
      photo_url: "https://official.example.com/actor-a.jpg",
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([local, official]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personImageSources: ["local", "official"],
        },
      }),
      {
        name: "Actor A",
        requiredField: "photo_url",
      },
    );

    expect(result.profile?.photo_url).toBe("/tmp/Actor A.jpg");
    expect(result.profileSources.photo_url).toBe("local");
    expect(local.lookup).toHaveBeenCalledTimes(1);
    expect(official.lookup).not.toHaveBeenCalled();
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

  it("keeps overview metadata from the first qualified overview source instead of mixing fields across sites", async () => {
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

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([official, avbase, avjoho]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official", "avbase", "avjoho"],
          personImageSources: ["official", "avbase"],
        },
      }),
      {
        name: "Actor A",
      },
    );

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
  });

  it("falls back to a later overview source when an earlier source is too sparse", async () => {
    const official = createSource("official", {
      aliases: ["Official Alias"],
    });
    const avbase = createSource("avbase", {
      birth_date: "1999-05-08",
      birth_place: "神奈川県",
      height_cm: 166,
    });

    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([official, avbase]),
    });

    const result = await provider.lookup(
      createConfig({
        personSync: {
          ...defaultConfiguration.personSync,
          personOverviewSources: ["official", "avbase"],
        },
      }),
      {
        name: "Actor A",
      },
    );

    expect(result.profile.birth_date).toBe("1999-05-08");
    expect(result.profile.birth_place).toBe("神奈川県");
    expect(result.profile.height_cm).toBe(166);
    expect(result.profileSources.birth_date).toBe("avbase");
    expect(result.profile.aliases).toEqual(["Official Alias"]);
  });
});
