import { configurationSchema } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import { FileOrganizer } from "./FileOrganizer";
import { NfoGenerator } from "./nfo";

describe("canonicalizeCrawlerDataActorAliases", () => {
  it("canonicalizes new output data independently of the translation setting", () => {
    const configuration = configurationSchema.parse({
      translate: { enableTranslation: false },
      paths: { mediaPath: "/library" },
      personSync: {
        actorAliases: {
          河北彩花: ["河北彩伽", "河北彩花（河北彩伽）"],
        },
      },
    });
    const crawlerData = canonicalizeCrawlerDataActorAliases(
      {
        title: "Example",
        number: "ABC-123",
        actors: ["河北彩伽", "河北彩花"],
        actor_profiles: [{ name: "河北彩伽", photo_url: "https://example.com/actor.jpg" }],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      configuration,
    );

    expect(crawlerData.actors).toEqual(["河北彩花"]);
    expect(crawlerData.actor_profiles).toEqual([
      {
        name: "河北彩花",
        aliases: ["河北彩伽"],
        photo_url: "https://example.com/actor.jpg",
      },
    ]);
    expect(
      new FileOrganizer().plan(
        {
          filePath: "/library/ABC-123.mp4",
          fileName: "ABC-123",
          extension: ".mp4",
          number: "ABC-123",
          isSubtitled: false,
        },
        crawlerData,
        configuration,
      ).outputDir,
    ).toContain("河北彩花");
    expect(new NfoGenerator().buildXml(crawlerData)).toContain("<name>河北彩花</name>");
  });

  it("creates a profile seed so an alias survives actor-image preparation", () => {
    const configuration = configurationSchema.parse({
      personSync: { actorAliases: { 三上悠亚: ["鬼頭桃菜"] } },
    });
    const crawlerData = canonicalizeCrawlerDataActorAliases(
      {
        title: "Example",
        number: "ABC-123",
        actors: ["鬼頭桃菜"],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      configuration,
    );

    expect(crawlerData.actor_profiles).toEqual([{ name: "三上悠亚", aliases: ["鬼頭桃菜"] }]);
  });
});
