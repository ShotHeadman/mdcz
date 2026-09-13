import { describe, expect, it } from "vitest";
import { ActorSourceProvider } from "./ActorSourceProvider";
import { ActorSourceRegistry } from "./registry";
import type { ActorSourceResult, BaseActorSource } from "./types";

describe("ActorSourceProvider media-server ports", () => {
  it("reports an unregistered source as a failed result instead of throwing", async () => {
    const provider = new ActorSourceProvider({ registry: new ActorSourceRegistry() });

    const result = await provider.lookup(
      {
        paths: { actorPhotoFolder: "", mediaPath: "" },
        personSync: {
          actorAliases: [],
          personImageSources: ["gfriends"],
          personOverviewSources: [],
        },
      } as never,
      "Actor A",
    );

    expect(result.profile).toEqual({ name: "Actor A" });
    expect(result.warnings).toEqual(['Actor source "gfriends" is not registered.']);
  });

  it("stops calling later sources once the required field is satisfied", async () => {
    const calls: string[] = [];
    const createSource = (name: "local" | "gfriends", photoUrl?: string): BaseActorSource => ({
      name,
      lookup: async (): Promise<ActorSourceResult> => {
        calls.push(name);
        return { source: name, success: true, profile: { name: "Actor A", photo_url: photoUrl }, warnings: [] };
      },
    });
    const provider = new ActorSourceProvider({
      registry: new ActorSourceRegistry([
        createSource("local", "/photos/actor-a.jpg"),
        createSource("gfriends", "https://example.com/actor-a.jpg"),
      ]),
    });

    const result = await provider.lookup(
      {
        paths: { actorPhotoFolder: "", mediaPath: "" },
        personSync: {
          actorAliases: [],
          personImageSources: ["local", "gfriends"],
          personOverviewSources: [],
        },
      } as never,
      { name: "Actor A", requiredField: "photo_url" },
    );

    expect(calls).toEqual(["local"]);
    expect(result.profile.photo_url).toBe("/photos/actor-a.jpg");
    expect(result.profileSources.photo_url).toBe("local");
  });
});
