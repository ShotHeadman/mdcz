import { diffCrawlerData, diffCrawlerDataWithOptions } from "@main/services/scraper/maintenance/diffCrawlerData";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: ["Actor A"],
  actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("diffCrawlerData", () => {
  it("ignores actor thumbnail path changes because actor_profiles are execution-time derived data", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actor_profiles: [{ name: "Actor A", photo_url: "https://example.com/actor-a.png" }],
      }),
    );

    expect(diffs).toEqual([]);
  });

  it("still reports actor list changes through the actors field", () => {
    const diffs = diffCrawlerData(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }],
      }),
      createCrawlerData({
        actors: ["Actor A", "Actor B"],
        actor_profiles: [
          { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
          { name: "Actor B", photo_url: "https://example.com/actor-b.png" },
        ],
      }),
    );

    expect(diffs).toEqual([
      {
        field: "actors",
        label: "演员",
        oldValue: ["Actor A"],
        newValue: ["Actor A", "Actor B"],
        changed: true,
      },
    ]);
  });

  it("skips translated fields when translation is disabled for maintenance preview", () => {
    const diffs = diffCrawlerDataWithOptions(
      createCrawlerData({
        title: "Original Title",
        title_zh: "旧中文标题",
        plot: "Original Plot",
        plot_zh: "旧中文简介",
      }),
      createCrawlerData({
        title: "Original Title",
        title_zh: undefined,
        plot: "Original Plot",
        plot_zh: undefined,
      }),
      {
        includeTranslatedFields: false,
      },
    );

    expect(diffs).toEqual([]);
  });
});
