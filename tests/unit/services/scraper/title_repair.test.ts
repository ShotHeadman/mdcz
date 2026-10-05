import { NfoGenerator } from "@mdcz/runtime/scrape/nfo";
import { NamingEngine } from "@mdcz/runtime/scrape/organize/NamingEngine";
import { applyTextRepair } from "@mdcz/runtime/scrape/textRepair";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

const titleRepair = {
  enabled: true,
  stripTrailingActors: false,
};

const crawlerData = (title: string, actors: string[] = []) => ({
  title,
  number: "ABC-123",
  actors,
  genres: [],
  scene_images: [],
  website: Website.DMM,
});

describe("title repair", () => {
  it("restores masked and euphemistic title words but only masked plot words", () => {
    const repaired = applyTextRepair(
      {
        ...crawlerData("催●的●●相姦课程 痴×电车与麻*事件 合意なし"),
        plot: "●っ払うと無理やり犯●れた。部屋に閉じ込められた",
      },
      titleRepair,
    );

    expect(repaired).toMatchObject({
      title: "催眠的近親相姦课程 痴漢电车与麻薬事件 レイプ",
      original_title: "催●的●●相姦课程 痴×电车与麻*事件 合意なし",
      plot: "酔っ払うと無理やり犯された。部屋に閉じ込められた",
    });
  });

  it("leaves disabled, unmatched, and already repaired data unchanged", () => {
    const masked = { ...crawlerData("催●"), plot: "犯●れた" };
    expect(applyTextRepair(masked, { ...titleRepair, enabled: false })).toEqual(masked);
    expect(applyTextRepair(crawlerData("没有遮蔽"), titleRepair)).toEqual(crawlerData("没有遮蔽"));

    const repaired = { ...crawlerData("催眠"), original_title: "催●" };
    expect(applyTextRepair(repaired, titleRepair)).toEqual(repaired);
  });

  it.each([
    { title: "新人デビュー 三上悠亜", actors: ["三上悠亜"], strip: true, expected: "新人デビュー" },
    { title: "共演作品　A、B", actors: ["A", "B"], strip: true, expected: "共演作品" },
    { title: "共演作品（A / B）", actors: ["A", "B"], strip: true, expected: "共演作品" },
    { title: "三上悠亜", actors: ["三上悠亜"], strip: true, expected: "三上悠亜" },
    { title: "三上悠亜の休日", actors: ["三上悠亜"], strip: true, expected: "三上悠亜の休日" },
    { title: "新人デビュー 三上悠亜", actors: ["三上悠亜"], strip: false, expected: "新人デビュー 三上悠亜" },
  ])("strips trailing actor names only when enabled: $title", ({ title, actors, strip, expected }) => {
    const repaired = applyTextRepair(crawlerData(title, actors), { enabled: false, stripTrailingActors: strip });

    expect(repaired.title).toBe(expected);
    expect(repaired.original_title).toBeUndefined();
  });

  it("keeps the original title available to NFO and naming", () => {
    const data = applyTextRepair(crawlerData("催●课程"), titleRepair);
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
