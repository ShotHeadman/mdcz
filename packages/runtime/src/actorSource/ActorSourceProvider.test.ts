import { describe, expect, it } from "vitest";
import type { RuntimeInfoActorSourceProvider } from "../mediaserver/infoSync";
import type { RuntimePhotoActorSourceProvider } from "../mediaserver/photoSync";
import { ActorSourceProvider } from "./ActorSourceProvider";
import { ActorSourceRegistry } from "./registry";
import type { ActorSourceResult, BaseActorSource } from "./types";

/**
 * The media-server sync helpers only ever see an actor source through these two ports. Asserting
 * assignability here is what lets a host wire this provider into them without a cast.
 */
describe("ActorSourceProvider media-server ports", () => {
  it("satisfies the photo and info sync provider contracts", () => {
    const provider = new ActorSourceProvider({ registry: new ActorSourceRegistry() });
    const photoPort: RuntimePhotoActorSourceProvider = provider;
    const infoPort: RuntimeInfoActorSourceProvider = provider;

    expect(photoPort).toBe(provider);
    expect(infoPort).toBe(provider);
  });

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
