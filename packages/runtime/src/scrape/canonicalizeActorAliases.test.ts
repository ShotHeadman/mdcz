import { configurationSchema } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";

describe("canonicalizeCrawlerDataActorAliases", () => {
  it("canonicalizes actors and keeps original spellings as profile aliases", () => {
    const configuration = configurationSchema.parse({
      personSync: {
        actorAliases: {
          河北彩花: ["河北彩伽", "河北彩花（河北彩伽）"],
          三上悠亚: ["鬼頭桃菜"],
        },
      },
    });
    const crawlerData = canonicalizeCrawlerDataActorAliases(
      {
        title: "Example",
        number: "ABC-123",
        actors: ["河北彩伽", "河北彩花", "鬼頭桃菜"],
        actor_profiles: [{ name: "河北彩伽", photo_url: "https://example.com/actor.jpg" }],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      configuration,
    );

    expect(crawlerData.actors).toEqual(["河北彩花", "三上悠亚"]);
    expect(crawlerData.actor_profiles).toEqual([
      {
        name: "河北彩花",
        aliases: ["河北彩伽"],
        photo_url: "https://example.com/actor.jpg",
      },
      { name: "三上悠亚", aliases: ["鬼頭桃菜"] },
    ]);
  });
});
