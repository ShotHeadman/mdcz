import { NfoGenerator } from "@mdcz/runtime/scrape/nfo";
import { NamingEngine } from "@mdcz/runtime/scrape/organize/NamingEngine";
import { applyTitleRepair } from "@mdcz/runtime/scrape/titleRepair";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { previewTitleRepair } from "@mdcz/shared/titleRepair";
import { describe, expect, it } from "vitest";

const titleRepair = {
  enabled: true,
  rules: [
    { source: "催●", replacement: "催眠" },
    { source: "●●", replacement: "秘密" },
  ],
};

describe("title repair", () => {
  it("repairs multiple masked fragments and retains the original title", () => {
    const repaired = applyTitleRepair(
      {
        title: "催●的●●课程",
        number: "ABC-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      titleRepair,
    );

    expect(repaired).toMatchObject({ title: "催眠的秘密课程", original_title: "催●的●●课程" });
  });

  it("does not alter titles when disabled, unmatched, or already repaired", () => {
    expect(previewTitleRepair("催●", { ...titleRepair, enabled: false }).reason).toBe("disabled");
    expect(previewTitleRepair("没有遮蔽", titleRepair).reason).toBe("no_match");

    const data = {
      title: "催眠",
      original_title: "催●",
      number: "ABC-123",
      actors: [],
      genres: [],
      scene_images: [],
      website: Website.DMM,
    };
    expect(applyTitleRepair(data, titleRepair)).toBe(data);
  });

  it("does not derive an empty replacement result", () => {
    const preview = previewTitleRepair("催●", {
      ...defaultConfiguration.titleRepair,
      enabled: true,
      rules: [{ source: "催●", replacement: "" }],
    });

    expect(preview).toMatchObject({ repairedTitle: "催●", applied: false, reason: "no_match" });
  });

  it("keeps the original title available to NFO and naming consumers", () => {
    const data = applyTitleRepair(
      {
        title: "催●课程",
        number: "ABC-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      titleRepair,
    );
    const configuration = {
      ...defaultConfiguration,
      naming: {
        ...defaultConfiguration.naming,
        fileTemplate: "{originaltitle}",
      },
    };

    expect(new NfoGenerator().buildXml(data)).toContain("<originaltitle>催●课程</originaltitle>");
    expect(
      new NamingEngine().buildLayout(
        {
          filePath: "/tmp/ABC-123.mp4",
          fileName: "ABC-123",
          extension: ".mp4",
          number: "ABC-123",
          isSubtitled: false,
        },
        data,
        configuration,
      ).targetVideoFileName,
    ).toBe("催●课程.mp4");
  });
});
