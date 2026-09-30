import { NfoGenerator } from "@mdcz/runtime/scrape/nfo";
import { NamingEngine } from "@mdcz/runtime/scrape/organize/NamingEngine";
import { applyTitleRepair } from "@mdcz/runtime/scrape/titleRepair";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { previewTitleRepair } from "@mdcz/shared/titleRepair";
import { describe, expect, it } from "vitest";

const titleRepair = {
  enabled: true,
};

describe("title repair", () => {
  it("repairs builtin masked and euphemistic terms", () => {
    const repaired = applyTitleRepair(
      {
        title: "催●的●●相姦课程",
        number: "ABC-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      titleRepair,
    );

    expect(repaired).toMatchObject({ title: "催眠的近親相姦课程", original_title: "催●的●●相姦课程" });
    expect(previewTitleRepair("催〇的盗○记录", titleRepair)).toMatchObject({
      repairedTitle: "催眠的盗撮记录",
      matchedRules: ["催●", "盗●"],
    });
    expect(previewTitleRepair("痴×电车与麻*事件", titleRepair)).toMatchObject({
      repairedTitle: "痴漢电车与麻薬事件",
      matchedRules: ["麻●", "痴●"],
    });
    expect(previewTitleRepair("合意なし与閉じ込め", titleRepair).repairedTitle).toBe("レイプ与監禁");
  });

  it("leaves disabled, unmatched, and already repaired data unchanged", () => {
    expect(previewTitleRepair("催●", { enabled: false }).reason).toBe("disabled");
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

  it("keeps the original title available to NFO and naming", () => {
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
